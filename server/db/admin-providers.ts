import { sql } from "drizzle-orm";

import type { TrafficDays } from "./admin-traffic";
import type { SqlExecutor } from "./clerk-sync";
import { providerOutcomes, type ProviderOutcome } from "./schema/providers";
import { addDays, readDay, toCount, utcDay } from "./stats-window";

/**
 * The numbers of the providers for the admin dashboard (SAG-26, ADR-052): how many calls were made
 * to each one, how they ended, how long they took and how many requests were really sent. ONE
 * statement reads them from `provider_calls_daily`, the daily count that every Worker instance adds
 * to (`server/providers/call-log.ts`).
 *
 * What the count means, so the numbers are read right:
 * - It starts on the day the counter was deployed: `startedOn` says which day that is.
 * - It is approximate. An instance that dies before it writes loses what it held.
 * - A *call* is what the app asked for; the *requests* are what was really sent, retries included
 *   (a call that was never sent, because our own limit or circuit said no, has none).
 * - A call *failed* when it did not give an answer, whatever the reason, including the ones that
 *   were never sent.
 * - The window is whole days of UTC that end today, so today is in it, partly.
 * - What the providers answer in a cache is not measured. Nor is a quota: no provider gives one to
 *   compare with, so the page shows the requests of the busiest day instead.
 */

export type ProviderStat = {
  provider: string;
  calls: number;
  /** Calls that did not give an answer, whatever the reason. */
  failed: number;
  /** Calls that were never sent: our own limit or circuit said no. */
  notSent: number;
  requests: number;
  /** The most requests sent to this provider in one day of the window. */
  peakDayRequests: number;
  /** Milliseconds, over the calls that sent something. Null when none did. */
  latencyAvgMs: number | null;
  outcomes: Record<ProviderOutcome, number>;
};

export type ProviderDay = { day: string; calls: number; failed: number };

export type AdminProviders = {
  days: TrafficDays;
  /** First and last day of the window, `YYYY-MM-DD`, UTC. The last one is today. */
  from: string;
  to: string;
  /** The first day anything was counted, or null when nothing was. */
  startedOn: string | null;
  totals: {
    calls: number;
    failed: number;
    requests: number;
    latencyAvgMs: number | null;
    outcomes: Record<ProviderOutcome, number>;
  };
  /** The most called first. */
  providers: ProviderStat[];
  /** The days of the window, oldest first, with a row for the days with nothing. */
  perDay: ProviderDay[];
};

const notSentOutcomes: readonly ProviderOutcome[] = [
  "rate_limited",
  "circuit_open",
];

const emptyOutcomes = (): Record<ProviderOutcome, number> =>
  Object.fromEntries(providerOutcomes.map((key) => [key, 0])) as Record<
    ProviderOutcome,
    number
  >;

const isOutcome = (value: unknown): value is ProviderOutcome =>
  (providerOutcomes as readonly unknown[]).includes(value);

/** The average of a sum of milliseconds over the calls that sent something, or null. */
const average = (latency: number, sent: number): number | null =>
  sent > 0 ? latency / sent : null;

type Raw = Record<string, unknown>;

export async function getAdminProviders(
  db: SqlExecutor,
  now: Date,
  days: TrafficDays,
): Promise<AdminProviders> {
  const from = utcDay(addDays(now, 1 - days));
  const to = utcDay(now);

  const { rows } = await db.execute(sql`
    WITH win AS (
      SELECT day, provider, outcome, calls, requests, latency_ms
      FROM provider_calls_daily
      WHERE day >= ${from}::date AND day <= ${to}::date
    )
    SELECT 'total' AS part, NULL::date AS day, provider, outcome,
           sum(calls)::float8 AS calls, sum(requests)::float8 AS requests,
           sum(latency_ms)::float8 AS latency_ms
    FROM win GROUP BY provider, outcome
    UNION ALL
    SELECT 'peak', NULL, p.provider, '', 0, max(p.requests), 0
    FROM (SELECT provider, day, sum(requests)::float8 AS requests FROM win GROUP BY provider, day) p
    GROUP BY p.provider
    UNION ALL
    -- For a day the second number is the calls that failed, not the requests.
    SELECT 'day', day, '', '', sum(calls)::float8,
           coalesce(sum(calls) FILTER (WHERE outcome <> 'ok'), 0)::float8, 0
    FROM win GROUP BY day
    UNION ALL
    SELECT 'first', min(day), '', '', 0, 0, 0 FROM provider_calls_daily
  `);

  const stats = new Map<string, ProviderStat & { latency: number }>();
  const stat = (provider: string) => {
    let one = stats.get(provider);
    if (!one) {
      one = {
        provider,
        calls: 0,
        failed: 0,
        notSent: 0,
        requests: 0,
        peakDayRequests: 0,
        latencyAvgMs: null,
        outcomes: emptyOutcomes(),
        latency: 0,
      };
      stats.set(provider, one);
    }
    return one;
  };

  for (const row of rows as Raw[]) {
    if (row.part === "total" && isOutcome(row.outcome)) {
      const one = stat(String(row.provider));
      const calls = toCount(row.calls);
      one.calls += calls;
      one.requests += toCount(row.requests);
      one.latency += toCount(row.latency_ms);
      one.outcomes[row.outcome] += calls;
      if (row.outcome !== "ok") one.failed += calls;
      if (notSentOutcomes.includes(row.outcome)) one.notSent += calls;
    } else if (row.part === "peak") {
      stat(String(row.provider)).peakDayRequests = toCount(row.requests);
    }
  }

  const providers = [...stats.values()]
    .filter((one) => one.calls > 0)
    .sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider))
    .map(({ latency, ...one }) => ({
      ...one,
      latencyAvgMs: average(latency, one.calls - one.notSent),
    }));

  const totals = providers.reduce(
    (sum, one) => {
      sum.calls += one.calls;
      sum.failed += one.failed;
      sum.requests += one.requests;
      sum.sent += one.calls - one.notSent;
      sum.latency += (one.latencyAvgMs ?? 0) * (one.calls - one.notSent);
      for (const key of providerOutcomes)
        sum.outcomes[key] += one.outcomes[key];
      return sum;
    },
    {
      calls: 0,
      failed: 0,
      requests: 0,
      sent: 0,
      latency: 0,
      outcomes: emptyOutcomes(),
    },
  );

  const seen = new Map(
    (rows as Raw[])
      .filter((row) => row.part === "day")
      .flatMap((row) => {
        const date = readDay(row.day);
        return date ? [[date, row] as const] : [];
      }),
  );
  const perDay = Array.from({ length: days }, (_, index) => {
    const date = utcDay(addDays(now, index + 1 - days));
    const row = seen.get(date);
    return {
      day: date,
      calls: toCount(row?.calls),
      failed: toCount(row?.requests),
    };
  });

  const first = (rows as Raw[]).find((row) => row.part === "first");

  return {
    days,
    from,
    to,
    startedOn: first ? readDay(first.day) : null,
    totals: {
      calls: totals.calls,
      failed: totals.failed,
      requests: totals.requests,
      latencyAvgMs: average(totals.latency, totals.sent),
      outcomes: totals.outcomes,
    },
    providers,
    perDay,
  };
}
