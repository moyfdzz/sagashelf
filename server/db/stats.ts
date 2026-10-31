import { sql } from "drizzle-orm";

import type { ProfileDb } from "./profile";
import { type Genre, isGenre } from "../providers/genres";
import { localizedTitleSql } from "./titles";
import type { Locale } from "../providers/types";

// Neon (HTTP) and `pg` both answer a raw statement with `{ rows }`; the type of the shared
// database does not say so.
type RawRows = { rows: Record<string, unknown>[] };

/** The types the statistics can be narrowed to (SAG-91). Without one, every type is counted. */
export const statsTypes = [
  "movie",
  "series",
  "anime",
  "book",
  "manga",
] as const;
export type StatsType = (typeof statsTypes)[number];

export const isStatsType = (value: unknown): value is StatsType =>
  typeof value === "string" &&
  (statsTypes as readonly string[]).includes(value);

/** A condition on the type of the title, as part of a `WHERE`, or nothing when no type is asked. */
const ofType = (alias: string, type: StatsType | undefined) =>
  type ? sql`AND ${sql.raw(alias)}.type = ${type}::media_type` : sql``;

/** A title of the library, as the lists of the statistics page show it. */
type TitleRef = {
  mediaId: string;
  title: string;
  type: string;
  year: number | null;
};

/** What one genre of our list adds up to in the library of a person (SAG-86). */
export type GenreStat = {
  genre: Genre;
  /** Entries of the genre that are not planned. A title with several genres is in each one. */
  titles: number;
  /** Minutes watched of the titles of the genre that have a length. */
  minutes: number;
  pagesRead: number;
  chaptersRead: number;
  volumesRead: number;
  /** How many of those entries have a score, and their mean (null when none). */
  scored: number;
  averageScore: number | null;
};

/** The numbers of the statistics page of one person (SAG-61, SAG-85, SAG-86, ADR-023). */
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
  best: (TitleRef & { score: number })[];
  /** Minutes watched of each type that has a length (movies, series, anime), as in the tiles. */
  minutesByType: Record<string, number>;
  /** The mean score and how many were given, for each type that has a scored title. */
  scoreByType: Record<string, { average: number; scored: number }>;
  /** The titles with the most minutes watched, the most first. */
  mostWatched: (TitleRef & { minutes: number })[];
  /** The titles watched again most times, with the minutes those extra viewings took. */
  mostRewatched: (TitleRef & { rewatches: number; minutes: number })[];
  /**
   * How long finishing something takes, from the start date to the finish date of each finished
   * viewing. `skipped` are the finished viewings that lack one of the two dates.
   */
  finishTime: { medianDays: number | null; counted: number; skipped: number };
  /** The planned titles that were added longest ago, the oldest first; `addedOn` is `YYYY-MM-DD`. */
  oldestPlanned: (TitleRef & { addedOn: string })[];
  /** Every genre of the entries that are not planned, the one with the most titles first. */
  byGenre: GenreStat[];
  /** Entries that are not planned and have no genre (not filled yet, or none of ours fits). */
  withoutGenre: number;
};

export const bestCount = 10;
export const shortListCount = 5;

// What the numbers of one person are made of: each entry with the times it was watched and the
// episodes seen. A finished run counts every episode of the title, as the entry editor does.
// Everything is read with the id of the person of the verified session.
const entriesOf = (userId: string, type?: StatsType) => sql`
  WITH e AS (
    SELECT le.id, le.media_id, le.status::text AS status, le.score, le.progress,
           le.progress_unit, mi.type::text AS type, mi.year, mi.runtime_minutes AS runtime,
           mi.genres,
           (SELECT count(*)::int FROM library_viewings v WHERE v.entry_id = le.id) AS viewings,
           (
             SELECT count(*)::int FROM media_parts p
             JOIN media_parts s ON s.id = p.parent_id
             WHERE p.media_id = mi.id AND p.kind = 'episode' AND s.number > 0
           ) AS total_episodes
    FROM library_entries le
    JOIN media_items mi ON mi.id = le.media_id
    WHERE le.user_id = ${userId}::uuid ${ofType("mi", type)}
  ),
  t AS (
    SELECT e.*,
           e.viewings + (CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS times,
           CASE WHEN e.type IN ('series', 'anime') AND e.progress_unit IS NULL
                THEN e.progress + e.viewings * e.total_episodes ELSE 0 END AS episodes
    FROM e
  ),
  w AS (
    SELECT t.*,
           CASE WHEN t.runtime > 0 THEN t.runtime * (
             CASE WHEN t.type = 'movie' THEN t.times
                  WHEN t.type IN ('series', 'anime') THEN t.episodes ELSE 0 END
           ) ELSE 0 END AS minutes,
           CASE WHEN t.runtime > 0 THEN t.runtime * t.viewings * (
             CASE WHEN t.type = 'movie' THEN 1
                  WHEN t.type IN ('series', 'anime') THEN t.total_episodes ELSE 0 END
           ) ELSE 0 END AS rewatch_minutes
    FROM t
  )
`;

const num = (value: unknown) =>
  value === null || value === undefined ? 0 : Number(value);

export async function getStats(
  db: ProfileDb,
  userId: string,
  locale: Locale,
  type?: StatsType,
): Promise<Stats> {
  const { rows: totals } = (await db.execute(sql`
    ${entriesOf(userId, type)}
    SELECT count(*)::int AS entries,
           count(*) FILTER (WHERE status = 'completed')::int AS completed,
           coalesce(sum(episodes), 0)::bigint AS episodes,
           coalesce(sum(viewings), 0)::bigint AS rewatches,
           coalesce(sum(minutes), 0)::bigint AS minutes_watched,
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
           avg(score)::float8 AS average_score,
           count(*) FILTER (
             WHERE status <> 'planned' AND (genres IS NULL OR jsonb_array_length(genres) = 0)
           )::int AS without_genre
    FROM w
  `)) as RawRows;

  const { rows: groups } = (await db.execute(sql`
    ${entriesOf(userId, type)}
    SELECT 'type' AS kind, type AS key, count(*)::float8 AS total FROM w GROUP BY type
    UNION ALL
    SELECT 'status', status, count(*)::float8 FROM w GROUP BY status
    UNION ALL
    SELECT 'score', score::text, count(*)::float8 FROM w WHERE score IS NOT NULL GROUP BY score
    UNION ALL
    SELECT 'released', year::text, count(*)::float8 FROM w WHERE year IS NOT NULL GROUP BY year
    UNION ALL
    SELECT 'minutes', type, sum(minutes)::float8 FROM w GROUP BY type HAVING sum(minutes) > 0
    UNION ALL
    SELECT 'scored', type, count(score)::float8 FROM w GROUP BY type HAVING count(score) > 0
    UNION ALL
    SELECT 'average', type, avg(score)::float8 FROM w GROUP BY type HAVING count(score) > 0
  `)) as RawRows;

  // Each finished viewing is an event: the current run of a completed entry, and every earlier
  // viewing. Their dates are optional, so the ones with no date are counted apart.
  const { rows: events } = (await db.execute(sql`
    WITH finished AS (
      SELECT le.finished_at AS day FROM library_entries le
      JOIN media_items mi ON mi.id = le.media_id
      WHERE le.user_id = ${userId}::uuid AND le.status = 'completed' ${ofType("mi", type)}
      UNION ALL
      SELECT v.finished_on FROM library_viewings v
      JOIN library_entries le ON le.id = v.entry_id
      JOIN media_items mi ON mi.id = le.media_id
      WHERE le.user_id = ${userId}::uuid ${ofType("mi", type)}
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
    WHERE le.user_id = ${userId}::uuid AND le.score IS NOT NULL ${ofType("mi", type)}
    ORDER BY le.score DESC, le.updated_at DESC, le.id
    LIMIT ${bestCount}
  `)) as RawRows;

  const { rows: watched } = (await db.execute(sql`
    ${entriesOf(userId, type)}
    SELECT w.media_id, ${localizedTitleSql("mi", locale)} AS title, w.type, w.year, w.minutes
    FROM w
    JOIN media_items mi ON mi.id = w.media_id
    WHERE w.minutes > 0
    ORDER BY w.minutes DESC, w.id
    LIMIT ${bestCount}
  `)) as RawRows;

  const { rows: rewatched } = (await db.execute(sql`
    ${entriesOf(userId, type)}
    SELECT w.media_id, ${localizedTitleSql("mi", locale)} AS title, w.type, w.year,
           w.viewings, w.rewatch_minutes
    FROM w
    JOIN media_items mi ON mi.id = w.media_id
    WHERE w.viewings > 0
    ORDER BY w.viewings DESC, w.rewatch_minutes DESC, w.id
    LIMIT ${shortListCount}
  `)) as RawRows;

  // The span of each finished viewing, from the entry's own dates and from every earlier viewing.
  const { rows: spans } = (await db.execute(sql`
    WITH finished AS (
      SELECT le.started_at AS started, le.finished_at AS finished FROM library_entries le
      JOIN media_items mi ON mi.id = le.media_id
      WHERE le.user_id = ${userId}::uuid AND le.status = 'completed' ${ofType("mi", type)}
      UNION ALL
      SELECT v.started_on, v.finished_on FROM library_viewings v
      JOIN library_entries le ON le.id = v.entry_id
      JOIN media_items mi ON mi.id = le.media_id
      WHERE le.user_id = ${userId}::uuid ${ofType("mi", type)}
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE started IS NOT NULL AND finished IS NOT NULL)::int AS counted,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY (finished - started)::float8)
             FILTER (WHERE started IS NOT NULL AND finished IS NOT NULL))::float8 AS median
    FROM finished
  `)) as RawRows;

  const { rows: oldest } = (await db.execute(sql`
    SELECT le.media_id, ${localizedTitleSql("mi", locale)} AS title, mi.type::text AS type,
           mi.year, le.created_at::date::text AS added_on
    FROM library_entries le
    JOIN media_items mi ON mi.id = le.media_id
    WHERE le.user_id = ${userId}::uuid AND le.status = 'planned' ${ofType("mi", type)}
    ORDER BY le.created_at, le.id
    LIMIT ${shortListCount}
  `)) as RawRows;

  // A title with several genres is in the row of each one. The statement reads the keys as text
  // and the code keeps only the ones of the list.
  const { rows: genreRows } = (await db.execute(sql`
    ${entriesOf(userId, type)}
    SELECT g.genre AS genre, count(*)::int AS titles,
           coalesce(sum(w.minutes), 0)::float8 AS minutes,
           coalesce(sum(w.progress) FILTER (WHERE w.progress_unit = 'pages'), 0)::float8 AS pages,
           coalesce(sum(w.progress) FILTER (WHERE w.progress_unit = 'chapters'), 0)::float8 AS chapters,
           coalesce(sum(w.progress) FILTER (WHERE w.progress_unit = 'volumes'), 0)::float8 AS volumes,
           count(w.score)::int AS scored,
           avg(w.score)::float8 AS average
    FROM w
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(w.genres, '[]'::jsonb)) AS g(genre)
    WHERE w.status <> 'planned'
    GROUP BY g.genre
  `)) as RawRows;

  const [row = {}] = totals;
  const scores = Array.from({ length: 10 }, () => 0);
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const minutesByType: Record<string, number> = {};
  const scoredByType: Record<string, number> = {};
  const averageByType: Record<string, number> = {};
  const released: { year: number; count: number }[] = [];
  for (const group of groups) {
    const key = String(group.key);
    const total = num(group.total);
    if (group.kind === "type") byType[key] = total;
    else if (group.kind === "status") byStatus[key] = total;
    else if (group.kind === "score") scores[Number(key) - 1] = total;
    else if (group.kind === "minutes") minutesByType[key] = total;
    else if (group.kind === "scored") scoredByType[key] = total;
    else if (group.kind === "average") averageByType[key] = total;
    else released.push({ year: Number(key), count: total });
  }
  const scoreByType = Object.fromEntries(
    Object.entries(scoredByType).map(([type, scored]) => [
      type,
      { average: averageByType[type] ?? 0, scored },
    ]),
  );
  const titleOf = (entry: Record<string, unknown>) => ({
    mediaId: String(entry.media_id),
    title: String(entry.title),
    type: String(entry.type),
    year: entry.year === null ? null : num(entry.year),
  });
  const [span = {}] = spans;

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
    best: best.map((entry) => ({ ...titleOf(entry), score: num(entry.score) })),
    minutesByType,
    scoreByType,
    mostWatched: watched.map((entry) => ({
      ...titleOf(entry),
      minutes: num(entry.minutes),
    })),
    mostRewatched: rewatched.map((entry) => ({
      ...titleOf(entry),
      rewatches: num(entry.viewings),
      minutes: num(entry.rewatch_minutes),
    })),
    finishTime: {
      medianDays: span.median === null ? null : num(span.median),
      counted: num(span.counted),
      skipped: num(span.total) - num(span.counted),
    },
    oldestPlanned: oldest.map((entry) => ({
      ...titleOf(entry),
      addedOn: String(entry.added_on),
    })),
    byGenre: genreRows
      .filter((entry) => isGenre(entry.genre))
      .map((entry) => ({
        genre: entry.genre as Genre,
        titles: num(entry.titles),
        minutes: num(entry.minutes),
        pagesRead: num(entry.pages),
        chaptersRead: num(entry.chapters),
        volumesRead: num(entry.volumes),
        scored: num(entry.scored),
        averageScore: entry.average === null ? null : num(entry.average),
      }))
      .sort((a, b) => b.titles - a.titles || a.genre.localeCompare(b.genre)),
    withoutGenre: num(row.without_genre),
  };
}
