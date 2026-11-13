import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import {
  addDays,
  readDay,
  toCount as count,
  utcDay as day,
} from "./stats-window";

/**
 * The webhook numbers of the admin dashboard (SAG-26): what Clerk sent us and what we sent to the
 * endpoints of the people. ONE statement reads them from the tables that already hold them
 * (`processed_webhooks`, `outbox`, `webhook_deliveries` and `webhook_endpoints`), so nothing new is
 * written on the way of a webhook.
 *
 * What the tables hold, so the numbers are read right:
 * - The log of deliveries is kept 30 days (`keepDays` of `webhooks.ts`), so the windows stop there.
 * - An incoming event that was a repeat, or that was older than what we hold, leaves no count of its
 *   own: `processed_webhooks` has one row for each event that was handled, once. Duplicates are not
 *   measured, and the page says so.
 * - The window is whole days of UTC that end today (these tables are read as they are, with no
 *   rollup), so today is in it, partly.
 */

/** The windows the page offers, in days. None is longer than the log of deliveries. */
export const webhookDays = [7, 30] as const;
export type WebhookDays = (typeof webhookDays)[number];
export const defaultWebhookDays: WebhookDays = 30;

/**
 * The window asked in the address. Only the numbers the page offers are accepted: anything else,
 * even `7 ` with a space (`Number` reads it as 7), is the default.
 */
export function parseWebhookDays(raw: string | null): WebhookDays {
  if (raw === null || !/^[1-9]\d{0,2}$/.test(raw)) return defaultWebhookDays;
  return webhookDays.find((days) => days === Number(raw)) ?? defaultWebhookDays;
}

/** How an attempt to deliver ended, by the status the endpoint answered with. */
export const attemptResults = [
  "ok",
  "client_error",
  "server_error",
  "no_response",
  "other",
] as const;
export type AttemptResult = (typeof attemptResults)[number];

/** Where an event to deliver stands. */
export const eventStatuses = ["pending", "delivered", "failed"] as const;
export type EventStatus = (typeof eventStatuses)[number];

export type WebhookDay = { day: string; attempts: number; failed: number };

export type AdminWebhooks = {
  days: WebhookDays;
  /** First and last day of the window, `YYYY-MM-DD`, UTC. The last one is today. */
  from: string;
  to: string;
  clerk: {
    /** Events from Clerk that were handled, once each. */
    processed: number;
    /** Accounts that were refused, by the reason (`taken`, `reserved_username`…). */
    rejected: { reason: string; count: number }[];
  };
  /** Attempts to deliver, by how they ended. */
  attempts: Record<AttemptResult, number>;
  /** Milliseconds, over the attempts that have a time. Null when there are none. */
  latencyAvgMs: number | null;
  latencyP95Ms: number | null;
  /** Events to deliver made in the window, by where they stand now. */
  events: Record<EventStatus, number>;
  /** Events waiting to be delivered right now, whatever day they were made. */
  pendingNow: number;
  endpoints: {
    total: number;
    enabled: number;
    /** Turned off, by the reason the delivery job gave (`unauthorized`, `not_found`…). */
    disabled: { reason: string; count: number }[];
  };
  /** The days of the window, oldest first, with a row for the days with nothing. */
  perDay: WebhookDay[];
};

/** A `json` column as the client hands it over: already parsed, or as text. */
function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** A JSON object of counts, read into the keys the page knows (the rest are left out). */
function readCounts<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, number> {
  const parsed = readJson(value);
  const object =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    keys.map((key) => [key, count(object[key])]),
  ) as Record<K, number>;
}

/** A JSON object of counts as a list, the biggest first. */
function readList(value: unknown): { reason: string; count: number }[] {
  const parsed = readJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .map(([reason, n]) => ({ reason, count: count(n) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function readDays(value: unknown): WebhookDay[] {
  const list = readJson(value);
  if (!Array.isArray(list)) return [];
  return list.flatMap(
    (row: { day?: unknown; attempts?: unknown; failed?: unknown }) => {
      const date = readDay(row.day);
      return date
        ? [
            {
              day: date,
              attempts: count(row.attempts),
              failed: count(row.failed),
            },
          ]
        : [];
    },
  );
}

export async function getAdminWebhooks(
  db: SqlExecutor,
  now: Date,
  days: WebhookDays,
): Promise<AdminWebhooks> {
  const from = day(addDays(now, 1 - days));
  const to = day(now);
  const start = `${from}T00:00:00Z`;
  const end = `${day(addDays(now, 1))}T00:00:00Z`;

  const { rows } = await db.execute(sql`
    WITH attempts AS (
      SELECT (d.created_at AT TIME ZONE 'UTC')::date AS day, d.latency_ms,
             CASE WHEN d.status_code BETWEEN 200 AND 299 THEN 'ok'
                  WHEN d.status_code BETWEEN 400 AND 499 THEN 'client_error'
                  WHEN d.status_code BETWEEN 500 AND 599 THEN 'server_error'
                  WHEN d.status_code IS NULL THEN 'no_response'
                  ELSE 'other' END AS result
      FROM webhook_deliveries d
      WHERE d.created_at >= ${start}::timestamptz AND d.created_at < ${end}::timestamptz
    ),
    series AS (
      -- Whole dates, so a change of time zone or of daylight saving cannot add or drop a row.
      SELECT s.moment::date AS day
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS s(moment)
    ),
    per_day AS (
      SELECT series.day,
             count(a.result)::int AS attempts,
             (count(a.result) FILTER (WHERE a.result <> 'ok'))::int AS failed
      FROM series LEFT JOIN attempts a ON a.day = series.day
      GROUP BY series.day
    )
    SELECT
      (SELECT count(*)::int FROM processed_webhooks
       WHERE provider = 'clerk'
         AND processed_at >= ${start}::timestamptz AND processed_at < ${end}::timestamptz) AS clerk_processed,
      (SELECT coalesce(json_object_agg(r.reason, r.n), '{}'::json) FROM (
         SELECT coalesce(payload ->> 'reason', 'unknown') AS reason, count(*)::int AS n
         FROM outbox
         WHERE type = 'clerk.user_rejected'
           AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
         GROUP BY 1) r) AS clerk_rejected,
      (SELECT coalesce(json_object_agg(r.result, r.n), '{}'::json)
       FROM (SELECT result, count(*)::int AS n FROM attempts GROUP BY result) r) AS results,
      (SELECT avg(latency_ms)::float8 FROM attempts WHERE latency_ms IS NOT NULL) AS latency_avg,
      (SELECT (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::float8
       FROM attempts WHERE latency_ms IS NOT NULL) AS latency_p95,
      (SELECT coalesce(json_object_agg(r.status, r.n), '{}'::json) FROM (
         SELECT status::text AS status, count(*)::int AS n
         FROM outbox
         WHERE endpoint_id IS NOT NULL
           AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
         GROUP BY status) r) AS events,
      (SELECT count(*)::int FROM outbox
       WHERE endpoint_id IS NOT NULL AND status = 'pending') AS pending_now,
      (SELECT count(*)::int FROM webhook_endpoints) AS endpoints_total,
      (SELECT count(*)::int FROM webhook_endpoints WHERE enabled) AS endpoints_enabled,
      (SELECT coalesce(json_object_agg(r.reason, r.n), '{}'::json) FROM (
         SELECT coalesce(disabled_reason, 'unknown') AS reason, count(*)::int AS n
         FROM webhook_endpoints WHERE NOT enabled GROUP BY 1) r) AS endpoints_disabled,
      (SELECT coalesce(json_agg(json_build_object(
                'day', p.day, 'attempts', p.attempts, 'failed', p.failed) ORDER BY p.day), '[]'::json)
       FROM per_day p) AS per_day
  `);

  const row = rows[0] ?? {};
  return {
    days,
    from,
    to,
    clerk: {
      processed: count(row.clerk_processed),
      rejected: readList(row.clerk_rejected),
    },
    attempts: readCounts(row.results, attemptResults),
    latencyAvgMs:
      row.latency_avg === null || row.latency_avg === undefined
        ? null
        : count(row.latency_avg),
    latencyP95Ms:
      row.latency_p95 === null || row.latency_p95 === undefined
        ? null
        : count(row.latency_p95),
    events: readCounts(row.events, eventStatuses),
    pendingNow: count(row.pending_now),
    endpoints: {
      total: count(row.endpoints_total),
      enabled: count(row.endpoints_enabled),
      disabled: readList(row.endpoints_disabled),
    },
    perDay: readDays(row.per_day),
  };
}
