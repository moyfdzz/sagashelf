import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/** A series whose next episode is due to be asked about. */
export type ShowToCheck = { mediaId: string; tvmazeId: number };

/**
 * The series and anime whose show in TVmaze is known (Wikidata gave its id) and that were never
 * asked about or whose time has come (`next_check_at`), the ones in a library first, then the ones
 * waiting longest. The list is the whole schedule: nothing else decides who is asked.
 */
export async function findShowsToCheck(
  db: SqlExecutor,
  limit: number,
): Promise<ShowToCheck[]> {
  const { rows } = await db.execute(sql`
    SELECT mw.media_id, mw.tvmaze_id
    FROM media_wikidata mw
    JOIN media_items m ON m.id = mw.media_id
    LEFT JOIN media_next_episode ne ON ne.media_id = mw.media_id
    WHERE mw.tvmaze_id IS NOT NULL AND m.type IN ('series', 'anime')
      AND (ne.media_id IS NULL OR ne.next_check_at <= now())
    ORDER BY EXISTS (SELECT 1 FROM library_entries le WHERE le.media_id = m.id) DESC,
             ne.next_check_at NULLS FIRST, mw.media_id
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    mediaId: String(row.media_id),
    tvmazeId: Number(row.tvmaze_id),
  }));
}

export type NextEpisodeToSave = {
  mediaId: string;
  tvmazeId: number;
  showStatus: string | null;
  airDate: string | null;
  airStamp: string | null;
  season: number | null;
  number: number | null;
  episodeName: string | null;
  nextCheckAt: Date;
};

/** Saves what TVmaze said about each show, in one statement; a show already there is updated. */
export async function saveNextEpisodes(
  db: SqlExecutor,
  rows: readonly NextEpisodeToSave[],
): Promise<void> {
  if (rows.length === 0) return;
  const payload = JSON.stringify(
    rows.map((row) => ({
      media_id: row.mediaId,
      tvmaze_id: row.tvmazeId,
      show_status: row.showStatus,
      air_date: row.airDate,
      air_stamp: row.airStamp,
      season: row.season,
      number: row.number,
      episode_name: row.episodeName,
      next_check_at: row.nextCheckAt.toISOString(),
    })),
  );
  await db.execute(sql`
    INSERT INTO media_next_episode
      (media_id, tvmaze_id, show_status, air_date, air_stamp, season, number, episode_name,
       checked_at, next_check_at)
    SELECT media_id, tvmaze_id, show_status, air_date, air_stamp, season, number, episode_name,
           now(), next_check_at
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(
      media_id uuid, tvmaze_id int, show_status text, air_date date, air_stamp timestamptz,
      season int, number int, episode_name text, next_check_at timestamptz)
    ON CONFLICT (media_id) DO UPDATE SET
      tvmaze_id = EXCLUDED.tvmaze_id, show_status = EXCLUDED.show_status,
      air_date = EXCLUDED.air_date, air_stamp = EXCLUDED.air_stamp,
      season = EXCLUDED.season, number = EXCLUDED.number,
      episode_name = EXCLUDED.episode_name, checked_at = now(),
      next_check_at = EXCLUDED.next_check_at
  `);
}

/**
 * Puts off a show TVmaze could not answer about, so a show that keeps failing does not take a
 * place in every run. What was known of its next episode is kept.
 */
export async function postponeShows(
  db: SqlExecutor,
  shows: readonly ShowToCheck[],
  until: Date,
): Promise<void> {
  if (shows.length === 0) return;
  const payload = JSON.stringify(
    shows.map((show) => ({ media_id: show.mediaId, tvmaze_id: show.tvmazeId })),
  );
  await db.execute(sql`
    INSERT INTO media_next_episode (media_id, tvmaze_id, next_check_at)
    SELECT media_id, tvmaze_id, ${until.toISOString()}::timestamptz
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(media_id uuid, tvmaze_id int)
    ON CONFLICT (media_id) DO UPDATE SET next_check_at = EXCLUDED.next_check_at
  `);
}

/** The next episode of a title as its page shows it. */
export type NextEpisode = {
  /** `YYYY-MM-DD`. */
  airDate: string;
  season: number | null;
  number: number | null;
  name: string | null;
};

/**
 * The next episode of a title, or null when TVmaze knows of none or its date is long past (a date
 * a day old still shows: it is the date at the network, which can be a day behind ours).
 */
export async function getNextEpisode(
  db: SqlExecutor,
  mediaId: string,
): Promise<NextEpisode | null> {
  const { rows } = await db.execute(sql`
    SELECT air_date::text AS air_date, season, number, episode_name
    FROM media_next_episode
    WHERE media_id = ${mediaId}::uuid AND air_date IS NOT NULL
      AND air_date >= (now() AT TIME ZONE 'utc')::date - 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    airDate: String(row.air_date),
    season: row.season === null ? null : Number(row.season),
    number: row.number === null ? null : Number(row.number),
    name: row.episode_name === null ? null : String(row.episode_name),
  };
}
