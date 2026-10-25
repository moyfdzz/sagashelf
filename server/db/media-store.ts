import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { NormalizedMedia, NormalizedPart } from "../providers/types";

/** How long TMDB lets us keep what it sent (ADR-016). Refresh a row well before this. */
export const providerDataMaxAgeDays = 180;

/**
 * Writes a title the first time we see its external id and refreshes it afterwards, and returns
 * its id. One statement: the external id is claimed first, so two requests that bring the same
 * new title together end up with one row (the second waits on the unique index and then
 * updates). A title from a different source with the same name is a different row; matching them
 * is the job of the search (SAG-15).
 */
export async function saveMedia(
  db: SqlExecutor,
  media: NormalizedMedia,
): Promise<string> {
  const { provider, id } = media.externalId;
  const { rows } = await db.execute(sql`
    WITH fresh AS (SELECT uuidv7() AS id),
    claimed AS (
      INSERT INTO media_external_ids (media_id, provider, external_id)
      SELECT id, ${provider}::external_provider, ${id} FROM fresh
      ON CONFLICT (provider, external_id) DO UPDATE SET updated_at = now()
      RETURNING media_id, (xmax = 0) AS inserted
    ),
    created AS (
      INSERT INTO media_items
        (id, type, title, original_title, year, synopsis, image_url, status, popularity)
      SELECT media_id, ${media.type}::media_type, ${media.title}, ${media.originalTitle},
             ${media.year}, ${JSON.stringify(media.synopsis)}::jsonb, ${media.imageUrl},
             ${media.status}::media_status, ${media.popularity}
      FROM claimed WHERE inserted
      RETURNING id
    ),
    refreshed AS (
      -- A synopsis in another language that we already hold is kept; the new one is added.
      UPDATE media_items SET
        type = ${media.type}::media_type,
        title = ${media.title},
        original_title = ${media.originalTitle},
        year = ${media.year},
        synopsis = synopsis || ${JSON.stringify(media.synopsis)}::jsonb,
        image_url = ${media.imageUrl},
        status = ${media.status}::media_status,
        popularity = ${media.popularity},
        fetched_at = now(),
        updated_at = now()
      WHERE id IN (SELECT media_id FROM claimed WHERE NOT inserted)
      RETURNING id
    )
    SELECT media_id FROM claimed
  `);
  const mediaId = rows[0]?.media_id;
  if (typeof mediaId !== "string") {
    throw new Error("saveMedia: the statement returned no id");
  }
  return mediaId;
}

/**
 * Writes the seasons and episodes of a title, and updates the ones already there. One
 * statement, so a series is stored whole or not at all. Episodes point to their season.
 */
export async function saveParts(
  db: SqlExecutor,
  mediaId: string,
  parts: readonly NormalizedPart[],
): Promise<void> {
  if (parts.length === 0) return;
  const payload = JSON.stringify(
    parts.map((part) => ({
      kind: part.kind,
      number: part.number,
      title: part.title,
      air_date: part.airDate,
      season: part.seasonNumber ?? null,
    })),
  );
  await db.execute(sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
        AS x(kind text, number int, title text, air_date date, season int)
    ),
    seasons AS (
      INSERT INTO media_parts (media_id, kind, parent_id, number, title, air_date)
      SELECT ${mediaId}::uuid, 'season', NULL, number, title, air_date
      FROM input WHERE kind = 'season'
      ON CONFLICT ON CONSTRAINT media_parts_media_kind_parent_number_unique
      DO UPDATE SET title = EXCLUDED.title, air_date = EXCLUDED.air_date, updated_at = now()
      RETURNING id, number
    ),
    episodes AS (
      INSERT INTO media_parts (media_id, kind, parent_id, number, title, air_date)
      SELECT ${mediaId}::uuid, 'episode', seasons.id, input.number, input.title, input.air_date
      FROM input JOIN seasons ON seasons.number = input.season
      WHERE input.kind = 'episode'
      ON CONFLICT ON CONSTRAINT media_parts_media_kind_parent_number_unique
      DO UPDATE SET title = EXCLUDED.title, air_date = EXCLUDED.air_date, updated_at = now()
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM seasons)::int AS seasons,
           (SELECT count(*) FROM episodes)::int AS episodes
  `);
}

/**
 * The titles whose provider data is older than `maxAgeDays`, oldest first, so a job can refresh
 * them before the 6 months TMDB allows run out. Returns the source and its id.
 */
export async function findStaleMedia(
  db: SqlExecutor,
  maxAgeDays: number = providerDataMaxAgeDays - 30,
  limit = 100,
): Promise<{ mediaId: string; provider: string; externalId: string }[]> {
  const { rows } = await db.execute(sql`
    SELECT m.id AS media_id, e.provider::text AS provider, e.external_id
    FROM media_items m
    JOIN media_external_ids e ON e.media_id = m.id
    WHERE m.type <> 'custom'
      AND m.fetched_at < now() - make_interval(days => ${maxAgeDays})
    ORDER BY m.fetched_at
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    mediaId: String(row.media_id),
    provider: String(row.provider),
    externalId: String(row.external_id),
  }));
}
