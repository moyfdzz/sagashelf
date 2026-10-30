import { sql } from "drizzle-orm";

import type { ProfileDb } from "./profile";
import { localizedTitleSql } from "./titles";
import type { Locale } from "../providers/types";

// Neon (HTTP) and `pg` both answer a raw statement with `{ rows }`; the type of the shared
// database does not say so.
type RawRows = { rows: Record<string, unknown>[] };

/** The numbers of the statistics page of one person (SAG-61, ADR-023). */
export type Stats = {
  /** Every entry of the library, whatever its status. */
  entries: number;
  completed: number;
  /** Episodes seen of series and anime: the current run and every earlier viewing. */
  episodesWatched: number;
  /** Times a title was watched again, that is, the earlier viewings of every entry. */
  rewatches: number;
  /** Minutes of what was watched, counting only titles with a known length. */
  minutesWatched: number;
  /** Minutes of what is pending, counting only titles with a known length. */
  minutesPlanned: number;
  /** Movies and series that were watched or are pending and have no length yet. */
  unknownRuntime: number;
  pagesRead: number;
  chaptersRead: number;
  volumesRead: number;
  /** The mean of the scores given, or null when none. */
  averageScore: number | null;
  scored: number;
  /** How many entries got each score: index 0 is the score 1, index 9 the score 10. */
  scores: number[];
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  /** Entries by the year of release of the title, oldest first. */
  releasedByYear: { year: number; count: number }[];
  /** Viewings finished in each year (the entry's finish date and every earlier viewing's). */
  finishedByYear: { year: number; count: number }[];
  /** Viewings finished in each month, `month` from 1 to 12. */
  finishedByMonth: { year: number; month: number; count: number }[];
  /** Finished viewings that have no finish date, so no chart can place them. */
  undatedFinished: number;
  /** The best scored entries, the latest changed first among equals. */
  best: {
    mediaId: string;
    title: string;
    type: string;
    year: number | null;
    score: number;
  }[];
};

export const bestCount = 10;

// What the numbers of one person are made of: each entry with the times it was watched and the
// episodes seen. A finished run counts every episode of the title, as the entry editor does.
// Everything is read with the id of the person of the verified session.
const entriesOf = (userId: string) => sql`
  WITH e AS (
    SELECT le.id, le.media_id, le.status::text AS status, le.score, le.progress,
           le.progress_unit, mi.type::text AS type, mi.year, mi.runtime_minutes AS runtime,
           (SELECT count(*)::int FROM library_viewings v WHERE v.entry_id = le.id) AS viewings,
           (
             SELECT count(*)::int FROM media_parts p
             JOIN media_parts s ON s.id = p.parent_id
             WHERE p.media_id = mi.id AND p.kind = 'episode' AND s.number > 0
           ) AS total_episodes
    FROM library_entries le
    JOIN media_items mi ON mi.id = le.media_id
    WHERE le.user_id = ${userId}::uuid
  ),
  w AS (
    SELECT e.*,
           e.viewings + (CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS times,
           CASE WHEN e.type IN ('series', 'anime') AND e.progress_unit IS NULL
                THEN e.progress + e.viewings * e.total_episodes ELSE 0 END AS episodes
    FROM e
  )
`;

const num = (value: unknown) =>
  value === null || value === undefined ? 0 : Number(value);

export async function getStats(
  db: ProfileDb,
  userId: string,
  locale: Locale,
): Promise<Stats> {
  const { rows: totals } = (await db.execute(sql`
    ${entriesOf(userId)}
    SELECT count(*)::int AS entries,
           count(*) FILTER (WHERE status = 'completed')::int AS completed,
           coalesce(sum(episodes), 0)::bigint AS episodes,
           coalesce(sum(viewings), 0)::bigint AS rewatches,
           coalesce(sum(CASE WHEN runtime > 0 THEN runtime * (
             CASE WHEN type = 'movie' THEN times
                  WHEN type IN ('series', 'anime') THEN episodes ELSE 0 END
           ) ELSE 0 END), 0)::bigint AS minutes_watched,
           coalesce(sum(CASE WHEN status = 'planned' AND runtime > 0 THEN runtime * (
             CASE WHEN type = 'movie' THEN 1
                  WHEN type IN ('series', 'anime') THEN total_episodes ELSE 0 END
           ) ELSE 0 END), 0)::bigint AS minutes_planned,
           count(*) FILTER (
             WHERE type IN ('movie', 'series', 'anime') AND coalesce(runtime, 0) = 0
               AND (times > 0 OR episodes > 0 OR status = 'planned')
           )::int AS unknown_runtime,
           coalesce(sum(progress) FILTER (WHERE progress_unit = 'pages'), 0)::bigint AS pages,
           coalesce(sum(progress) FILTER (WHERE progress_unit = 'chapters'), 0)::bigint AS chapters,
           coalesce(sum(progress) FILTER (WHERE progress_unit = 'volumes'), 0)::bigint AS volumes,
           count(score)::int AS scored,
           avg(score)::float8 AS average_score
    FROM w
  `)) as RawRows;

  const { rows: groups } = (await db.execute(sql`
    ${entriesOf(userId)}
    SELECT 'type' AS kind, type AS key, count(*)::int AS total FROM w GROUP BY type
    UNION ALL
    SELECT 'status', status, count(*)::int FROM w GROUP BY status
    UNION ALL
    SELECT 'score', score::text, count(*)::int FROM w WHERE score IS NOT NULL GROUP BY score
    UNION ALL
    SELECT 'released', year::text, count(*)::int FROM w WHERE year IS NOT NULL GROUP BY year
  `)) as RawRows;

  // Each finished viewing is an event: the current run of a completed entry, and every earlier
  // viewing. Their dates are optional, so the ones with no date are counted apart.
  const { rows: events } = (await db.execute(sql`
    WITH finished AS (
      SELECT le.finished_at AS day FROM library_entries le
      WHERE le.user_id = ${userId}::uuid AND le.status = 'completed'
      UNION ALL
      SELECT v.finished_on FROM library_viewings v
      JOIN library_entries le ON le.id = v.entry_id
      WHERE le.user_id = ${userId}::uuid
    )
    SELECT extract(year FROM day)::int AS year, extract(month FROM day)::int AS month,
           count(*)::int AS total
    FROM finished GROUP BY 1, 2 ORDER BY 1, 2
  `)) as RawRows;

  const { rows: best } = (await db.execute(sql`
    SELECT le.media_id, ${localizedTitleSql("mi", locale)} AS title, mi.type::text AS type,
           mi.year, le.score
    FROM library_entries le
    JOIN media_items mi ON mi.id = le.media_id
    WHERE le.user_id = ${userId}::uuid AND le.score IS NOT NULL
    ORDER BY le.score DESC, le.updated_at DESC, le.id
    LIMIT ${bestCount}
  `)) as RawRows;

  const [row = {}] = totals;
  const scores = Array.from({ length: 10 }, () => 0);
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const released: { year: number; count: number }[] = [];
  for (const group of groups) {
    const key = String(group.key);
    const total = num(group.total);
    if (group.kind === "type") byType[key] = total;
    else if (group.kind === "status") byStatus[key] = total;
    else if (group.kind === "score") scores[Number(key) - 1] = total;
    else released.push({ year: Number(key), count: total });
  }

  const finishedByMonth = events
    .filter((event) => event.year !== null)
    .map((event) => ({
      year: num(event.year),
      month: num(event.month),
      count: num(event.total),
    }));
  const years = new Map<number, number>();
  for (const event of finishedByMonth) {
    years.set(event.year, (years.get(event.year) ?? 0) + event.count);
  }

  return {
    entries: num(row.entries),
    completed: num(row.completed),
    episodesWatched: num(row.episodes),
    rewatches: num(row.rewatches),
    minutesWatched: num(row.minutes_watched),
    minutesPlanned: num(row.minutes_planned),
    unknownRuntime: num(row.unknown_runtime),
    pagesRead: num(row.pages),
    chaptersRead: num(row.chapters),
    volumesRead: num(row.volumes),
    averageScore: row.average_score === null ? null : num(row.average_score),
    scored: num(row.scored),
    scores,
    byType,
    byStatus,
    releasedByYear: released.sort((a, b) => a.year - b.year),
    finishedByYear: [...years]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    finishedByMonth,
    undatedFinished: num(events.find((event) => event.year === null)?.total),
    best: best.map((entry) => ({
      mediaId: String(entry.media_id),
      title: String(entry.title),
      type: String(entry.type),
      year: entry.year === null ? null : num(entry.year),
      score: num(entry.score),
    })),
  };
}
