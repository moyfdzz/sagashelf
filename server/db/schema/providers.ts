import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";

/**
 * How a call to a provider ended, written once for the table, the counter and the tests. `ok` is an
 * answer that was read; the `http_*` ones are the status the provider answered with (`http_429` is
 * the provider telling us to slow down); `timeout`, `network` and `invalid` are the ones in
 * `ProviderErrorKind`; `rate_limited` and `circuit_open` are calls that were never sent, because our
 * own bucket or circuit said no (SAG-26, ADR-052).
 */
export const providerOutcomes = [
  "ok",
  "http_4xx",
  "http_429",
  "http_5xx",
  "http_other",
  "timeout",
  "network",
  "invalid",
  "rate_limited",
  "circuit_open",
] as const;

export type ProviderOutcome = (typeof providerOutcomes)[number];

/**
 * The daily count of the calls to each provider (SAG-26, ADR-052): one row for each day, provider and
 * outcome, kept forever (a handful of rows a day). `calls` is what the app asked for, `requests` is
 * what was really sent (a retry is one more request, and a call that was never sent has none), and
 * `latency_ms` adds up the time of the calls that sent something. It holds no address, no search
 * text and no header: only who was asked, how it ended and how long it took. The numbers are written
 * from the memory of each Worker instance, so an instance that dies before it writes loses a few.
 */
export const providerCallsDaily = pgTable(
  "provider_calls_daily",
  {
    day: date("day").notNull(),
    provider: text("provider").notNull(),
    outcome: text("outcome").notNull(),
    calls: integer("calls").notNull(),
    requests: integer("requests").notNull(),
    latencyMs: bigint("latency_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.provider, t.outcome] }),
    check(
      "provider_calls_daily_outcome_check",
      sql`${t.outcome} in ('ok', 'http_4xx', 'http_429', 'http_5xx', 'http_other', 'timeout', 'network', 'invalid', 'rate_limited', 'circuit_open')`,
    ),
    check(
      "provider_calls_daily_provider_check",
      sql`${t.provider} ~ '^[a-z][a-z0-9_-]{1,29}$'`,
    ),
    check(
      "provider_calls_daily_counts_check",
      sql`${t.calls} >= 0 and ${t.requests} >= 0 and ${t.latencyMs} >= 0`,
    ),
  ],
);
