import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * The daily rollup of the analytics and the deletion of the raw events (SAG-24, ADR-009, ADR-050).
 * Each function is one statement, in a job of the cron that always runs.
 */

/** Raw events are kept 13 months; the rollups are kept forever. */
export const analyticsRetentionMonths = 13;

/** The most days one run rolls up: a few, so a run after a long stop is still a small statement. */
export const rollupDaysPerRun = 7;

/** The most values of a dimension kept for one day; the rest is one row, `(other)`. */
export const rollupValuesPerDimension = 100;

/**
 * The most raw events one deletion takes, so it is a bounded statement however much is waiting. The
 * job runs four times a day, so 80 000 events a day can be deleted, far more than a day of this site
 * writes; a backlog after a long stop is gone in a few runs.
 */
export const pruneBatchSize = 20_000;

export type RollupSummary = { days: number; rows: number };

/**
 * Rolls up the days that are over and not rolled up yet, oldest first, a few at a time. The day of
 * today is never rolled up (it is not over), and a day is told to be done by its row of the
 * dimension `kind`, which every day with an event has. Running it twice does the same thing: the
 * rows are replaced, not added to. An event is stored with the time it arrived, so once a day is
 * over no event arrives for it: nothing that is deleted later was left out of the rollup.
 *
 * Every event is spread over the dimensions that apply to it (the page, the source, the place, the
 * kind of device…) and counted there: `events` is what a person did, `visitors` the distinct
 * visitors, `engaged_ms` the visible time. Past `rollupValuesPerDimension` values in a dimension and
 * a day, the rest are one row with the value `(other)`, with their own distinct visitors. A real
 * value that is `(other)` gets a space after it first (a value is never kept with one, so it cannot
 * meet the row of the rest).
 */
export async function rollUpAnalytics(
  db: SqlExecutor,
  options: { days?: number; values?: number } = {},
): Promise<RollupSummary> {
  const days = options.days ?? rollupDaysPerRun;
  const values = options.values ?? rollupValuesPerDimension;
  const { rows } = await db.execute(sql`
    WITH todo AS (
      -- The days with events first, and only then which of them are not done: the check is made
      -- once for a day and not once for each event. There is no lower bound on purpose: a day is
      -- done by its own row, whatever the order the days were rolled up in.
      SELECT d.day FROM (
        SELECT DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date AS day
        FROM analytics_events e
        WHERE e.occurred_at < (((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC')
      ) d
      WHERE NOT EXISTS (
        SELECT 1 FROM analytics_daily a WHERE a.dimension = 'kind' AND a.day = d.day
      )
      ORDER BY d.day
      LIMIT ${days}::int
    ),
    picked AS (
      SELECT (e.occurred_at AT TIME ZONE 'UTC')::date AS day, e.*
      FROM analytics_events e
      WHERE e.occurred_at >= ((SELECT min(day) FROM todo)::timestamp AT TIME ZONE 'UTC')
        AND e.occurred_at < (((SELECT max(day) FROM todo) + 1)::timestamp AT TIME ZONE 'UTC')
        AND (e.occurred_at AT TIME ZONE 'UTC')::date IN (SELECT day FROM todo)
    ),
    spread AS (
      SELECT p.day, x.dimension,
             CASE WHEN x.value = '(other)' THEN '(other) ' ELSE x.value END AS value,
             p.visitor, p.kind, p.engaged_ms
      FROM picked p
      CROSS JOIN LATERAL (VALUES
        ('kind', p.kind),
        ('page', CASE WHEN p.kind IN ('pageview', 'engaged') THEN p.path END),
        ('referrer_class', p.referrer_class),
        ('referrer_host', p.referrer_host),
        ('utm_source', p.utm_source),
        ('utm_medium', p.utm_medium),
        ('utm_campaign', p.utm_campaign),
        ('country', CASE WHEN p.kind IN ('pageview', 'engaged') THEN p.country END),
        ('region', CASE WHEN p.kind IN ('pageview', 'engaged') THEN p.region END),
        ('device', CASE WHEN p.kind IN ('pageview', 'engaged') THEN p.device END),
        ('search_type', p.search_type)
      ) AS x(dimension, value)
      WHERE x.value IS NOT NULL
    ),
    counted AS (
      SELECT day, dimension, value,
             (count(*) FILTER (WHERE kind <> 'engaged'))::int AS events,
             (count(DISTINCT visitor) FILTER (WHERE kind <> 'engaged'))::int AS visitors,
             COALESCE(sum(engaged_ms), 0)::bigint AS engaged_ms
      FROM spread
      GROUP BY day, dimension, value
    ),
    ranked AS (
      SELECT c.*,
             row_number() OVER (
               PARTITION BY day, dimension ORDER BY events DESC, engaged_ms DESC, value
             ) AS place
      FROM counted c
    ),
    rest AS (
      SELECT s.day, s.dimension, '(other)'::text AS value,
             (count(*) FILTER (WHERE s.kind <> 'engaged'))::int AS events,
             (count(DISTINCT s.visitor) FILTER (WHERE s.kind <> 'engaged'))::int AS visitors,
             COALESCE(sum(s.engaged_ms), 0)::bigint AS engaged_ms
      FROM spread s
      JOIN ranked r USING (day, dimension, value)
      WHERE r.place > ${values}::int
      GROUP BY s.day, s.dimension
    ),
    rolled AS (
      INSERT INTO analytics_daily (day, dimension, value, events, visitors, engaged_ms)
      SELECT day, dimension, value, events, visitors, engaged_ms FROM ranked
      WHERE place <= ${values}::int
      UNION ALL
      SELECT day, dimension, value, events, visitors, engaged_ms FROM rest
      ON CONFLICT (day, dimension, value) DO UPDATE
      SET events = EXCLUDED.events,
          visitors = EXCLUDED.visitors,
          engaged_ms = EXCLUDED.engaged_ms
      RETURNING day
    )
    SELECT count(DISTINCT day)::int AS days, count(*)::int AS rows FROM rolled
  `);
  const row = rows[0] as { days?: number; rows?: number } | undefined;
  return { days: Number(row?.days ?? 0), rows: Number(row?.rows ?? 0) };
}

/**
 * Deletes the raw events older than 13 months, a batch at a time, and only the ones whose day was
 * rolled up: if the rollup is stuck, nothing is lost. In the same statement it deletes the salts of
 * the visitor code older than yesterday. Returns how many events were deleted.
 */
export async function pruneAnalyticsEvents(
  db: SqlExecutor,
  options: { batch?: number } = {},
): Promise<number> {
  const batch = options.batch ?? pruneBatchSize;
  const { rows } = await db.execute(sql`
    WITH old AS (
      SELECT e.id FROM analytics_events e
      WHERE e.occurred_at < now() - make_interval(months => ${analyticsRetentionMonths}::int)
        AND EXISTS (
          SELECT 1 FROM analytics_daily a
          WHERE a.dimension = 'kind' AND a.day = (e.occurred_at AT TIME ZONE 'UTC')::date
        )
      ORDER BY e.occurred_at
      LIMIT ${batch}::int
    ),
    -- The salts of the daily visitor code older than yesterday go too, whether or not anybody
    -- came: the policy says only today's and yesterday's are kept, and they are also deleted when
    -- a salt is asked for, which does not happen while nobody visits.
    salts AS (
      DELETE FROM analytics_salts WHERE day < (now() AT TIME ZONE 'UTC')::date - 1 RETURNING 1
    ),
    deleted AS (
      DELETE FROM analytics_events WHERE id IN (SELECT id FROM old) RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM deleted
  `);
  return Number(rows[0]?.deleted ?? 0);
}
