import { sql } from "drizzle-orm";

import type { TrafficDays } from "./admin-traffic";
import type { SqlExecutor } from "./clerk-sync";
import { addDays, toCount as count, utcDay as day } from "./stats-window";
import { sharedTitleSql } from "./titles";

/**
 * The content numbers of the admin dashboard (SAG-26): what people search for, how many titles
 * they wrote themselves and how much of the sagas is filled in. ONE statement reads them: the
 * searches from the daily rollup `analytics_daily` (never the raw events, and never the text of a
 * search, which is not kept: only its type, ADR-050), and the rest from small tables.
 *
 * The window is the `days` days that end yesterday (UTC), like the traffic page, because the
 * rollup never holds today. Searches that found nothing are not here: nothing records them yet.
 */

export type ContentSearch = { type: string; searches: number };

export type AdminContent = {
  days: TrafficDays;
  /** First and last day of the window, `YYYY-MM-DD`, UTC. */
  from: string;
  to: string;
  /** How many days of the window the rollup has done. A smaller number than `days` says so. */
  rolledDays: number;
  /** Searches by the type of title searched, the most searched first. */
  searches: ContentSearch[];
  /** Every title a person wrote by hand (`custom`), and the ones made in the window. */
  customTotal: number;
  customNew: number;
  sagasPublished: number;
  sagasDraft: number;
  /** Published sagas with no work in them: a visitor sees an empty page. */
  sagasEmpty: number;
  /** The works of the published sagas, and how many of them Wikidata has described. */
  works: number;
  worksDescribed: number;
};

/** The `json` column as the client hands it over: already parsed, or as text. */
function readSearches(value: unknown): ContentSearch[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map((row: { type?: unknown; searches?: unknown }) => ({
    type: String(row.type),
    searches: count(row.searches),
  }));
}

export async function getAdminContent(
  db: SqlExecutor,
  now: Date,
  days: TrafficDays,
): Promise<AdminContent> {
  const to = addDays(now, -1);
  const from = day(addDays(to, 1 - days));
  // The end is "before the start of today", so the whole of yesterday counts.
  const until = `${day(now)}T00:00:00Z`;

  const { rows } = await db.execute(sql`
    WITH written_by_hand AS (
      -- What is not a shared title is one a person wrote for themselves: the rule of what that is
      -- lives in one place (sharedTitleSql). Only the counts are read, never a title.
      SELECT (count(*) FILTER (WHERE NOT ${sharedTitleSql("m")}))::int AS custom_total,
             (count(*) FILTER (
               WHERE NOT ${sharedTitleSql("m")}
                 AND m.created_at >= ${`${from}T00:00:00Z`}::timestamptz
                 AND m.created_at < ${until}::timestamptz
             ))::int AS custom_new
      FROM media_items m
    )
    SELECT
      (SELECT coalesce(json_agg(json_build_object('type', s.value, 'searches', s.searches)
                                ORDER BY s.searches DESC, s.value), '[]'::json)
       FROM (
         SELECT value, sum(events) AS searches
         FROM analytics_daily
         WHERE dimension = 'search_type'
           AND day >= ${from}::date AND day <= ${day(to)}::date
           -- The rest of a day past the cap of the rollup is not a type of title.
           AND value NOT IN ('(other)', '(other) ')
         GROUP BY value
       ) s) AS searches,
      (SELECT count(DISTINCT day)::int FROM analytics_daily
       WHERE dimension = 'kind'
         AND day >= ${from}::date AND day <= ${day(to)}::date) AS rolled,
      (SELECT custom_total FROM written_by_hand) AS custom_total,
      (SELECT custom_new FROM written_by_hand) AS custom_new,
      (SELECT count(*)::int FROM sagas WHERE status = 'published') AS sagas_published,
      (SELECT count(*)::int FROM sagas WHERE status = 'draft') AS sagas_draft,
      (SELECT count(*)::int FROM sagas s
       WHERE s.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM saga_wikidata_members m WHERE m.saga_id = s.id)) AS sagas_empty,
      (SELECT count(*)::int FROM saga_wikidata_members m
       JOIN sagas s ON s.id = m.saga_id AND s.status = 'published') AS works,
      (SELECT count(*)::int FROM saga_wikidata_members m
       JOIN sagas s ON s.id = m.saga_id AND s.status = 'published'
       JOIN wikidata_items i ON i.qid = m.qid AND i.details_at IS NOT NULL) AS works_described
  `);

  const row = rows[0] ?? {};
  return {
    days,
    from,
    to: day(to),
    rolledDays: count(row.rolled),
    searches: readSearches(row.searches),
    customTotal: count(row.custom_total),
    customNew: count(row.custom_new),
    sagasPublished: count(row.sagas_published),
    sagasDraft: count(row.sagas_draft),
    sagasEmpty: count(row.sagas_empty),
    works: count(row.works),
    worksDescribed: count(row.works_described),
  };
}
