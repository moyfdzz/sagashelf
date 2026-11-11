import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { sharedTitleSql } from "./titles";
import type {
  Locale,
  NormalizedMedia,
  NormalizedPart,
} from "../providers/types";

/** How long TMDB lets us keep what it sent (ADR-016). Refresh a row well before this. */
export const providerDataMaxAgeDays = 180;

/** A title is refreshed this long before the 6 months TMDB lets us keep it (ADR-016). */
export const refreshAfterDays = providerDataMaxAgeDays - 30;

/**
 * Writes a title the first time we see its external id and refreshes it afterwards, and returns
 * its id. One statement: the external id is claimed first, so two requests that bring the same
 * new title together end up with one row (the second waits on the unique index and then
 * updates). A title from a different source with the same name is a different row; matching them
 * is the job of the search (SAG-15).
 *
 * `locale` is the language the provider was asked for. The title and the synopsis are kept per
 * language, so a visit in the other language does not show this one. A source with no synopsis in
 * that language is stored as an empty text, which says "asked, nothing there" (a missing key
 * says "not asked yet"); an empty text never replaces a synopsis we already hold.
 */
export async function saveMedia(
  db: SqlExecutor,
  media: NormalizedMedia,
  locale: Locale = "es",
  // False saves the language without marking the row as fresh, so a run that stops before the other
  // language leaves the title due for a refresh (SAG-182).
  markFresh = true,
): Promise<string> {
  const { provider, id } = media.externalId;
  // The title of the language asked for wins over one the source also sent for that language.
  const titles = JSON.stringify({ ...media.titles, [locale]: media.title });
  const synopsis = JSON.stringify(media.synopsis);
  const noSynopsis = JSON.stringify({ [locale]: "" });
  // Null says "the source sent no authors", which never replaces the ones we hold.
  const creators = media.creators?.length
    ? JSON.stringify(media.creators)
    : null;
  // TMDB is asked about the length of everything it holds, so no answer is saved as 0: "asked,
  // not known", which the refresh job does not ask again. Other sources never say a length.
  const askedRuntime = provider === "tmdb" ? 0 : null;
  // Null says "the source did not say", which never replaces the genres we hold; an empty list says
  // "asked, none of ours fits" and is kept only when we hold nothing.
  const genres = media.genres ? JSON.stringify(media.genres) : null;
  // The same for the ids in other catalogs: an empty object is kept only when we hold nothing.
  const crossIds = media.crossIds ? JSON.stringify(media.crossIds) : null;
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
        (id, type, title, titles, original_title, year, creators, synopsis, image_url, status,
         popularity, runtime_minutes, genres, cross_ids)
      SELECT media_id, ${media.type}::media_type, ${media.title}, ${titles}::jsonb,
             ${media.originalTitle}, ${media.year}, ${creators}::jsonb,
             ${noSynopsis}::jsonb || ${synopsis}::jsonb, ${media.imageUrl},
             ${media.status}::media_status, ${media.popularity},
             coalesce(${media.runtimeMinutes ?? null}::int, ${askedRuntime}::int),
             ${genres}::jsonb, ${crossIds}::jsonb
      FROM claimed WHERE inserted
      RETURNING id
    ),
    refreshed AS (
      -- A title or synopsis in another language that we already hold is kept; the new one is
      -- added.
      UPDATE media_items SET
        type = ${media.type}::media_type,
        title = ${media.title},
        titles = titles || ${titles}::jsonb,
        -- The source says null when the original title is the one of the language asked, so a
        -- null never erases the original title a visit in another language left.
        original_title = coalesce(${media.originalTitle}::text, original_title),
        -- A year, a poster or a status the source does not send this time never erases the one
        -- we hold (SAG-54).
        year = coalesce(${media.year}::int, year),
        creators = coalesce(${creators}::jsonb, creators),
        -- A length the source does not send this time never erases the one we hold.
        runtime_minutes = coalesce(${media.runtimeMinutes ?? null}::int, runtime_minutes,
                                   ${askedRuntime}::int),
        -- New genres replace the held ones; none (null) or an empty list never erases them.
        genres = coalesce(
          CASE WHEN jsonb_array_length(${genres}::jsonb) > 0 THEN ${genres}::jsonb END,
          genres, ${genres}::jsonb),
        cross_ids = coalesce(
          CASE WHEN ${crossIds}::jsonb <> '{}'::jsonb THEN ${crossIds}::jsonb END,
          cross_ids, ${crossIds}::jsonb),
        synopsis = ${noSynopsis}::jsonb || synopsis || ${synopsis}::jsonb,
        image_url = coalesce(${media.imageUrl}::text, image_url),
        status = CASE WHEN ${media.status} = 'unknown' THEN status
                      ELSE ${media.status}::media_status END,
        popularity = ${media.popularity},
        fetched_at = CASE WHEN ${markFresh} THEN now() ELSE fetched_at END,
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
 * statement, so a series is stored whole or not at all. Episodes point to their season. When the
 * episodes say how long they are, the title keeps their average as the length of an episode
 * (SAG-61); episodes that say nothing leave the length the title already has.
 */
export async function saveParts(
  db: SqlExecutor,
  mediaId: string,
  parts: readonly NormalizedPart[],
): Promise<void> {
  if (parts.length === 0) return;
  const lengths = parts.flatMap((part) =>
    part.kind === "episode" && part.runtimeMinutes ? [part.runtimeMinutes] : [],
  );
  const average = lengths.length
    ? Math.round(
        lengths.reduce((sum, minutes) => sum + minutes, 0) / lengths.length,
      )
    : null;
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
    ),
    runtime AS (
      UPDATE media_items SET runtime_minutes = ${average}::int, updated_at = now()
      WHERE id = ${mediaId}::uuid AND ${average}::int IS NOT NULL
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM seasons)::int AS seasons,
           (SELECT count(*) FROM episodes)::int AS episodes
  `);
}

/**
 * The titles the scheduled job should ask the provider about (SAG-54): the ones older than
 * `refreshAfterDays` (150 days, 30 before the 6 months TMDB allows, ADR-016), then the ones with
 * no title or synopsis in one of the two languages, the ones of TMDB that were saved before their
 * length was kept and the ones saved before their genres were kept (SAG-71) and the manga saved
 * before their ids in other catalogs were kept (SAG-16). The stale ones go first, then the ones
 * that are in somebody's library (so what a person sees is filled first), each group oldest first.
 * A title attempted in the last `retryAfterHours` is left out, so one the provider keeps failing
 * on cannot take the whole batch every run. A title of a provider not in `providerIds` (one that
 * is switched off) is left out too, for the same reason (SAG-179). A title people made themselves
 * (`custom`) is never returned (`sharedTitleSql`, SAG-196). The last attempt is the `updated_at`
 * of its external id: `saveMedia` sets it on a success and `markRefreshAttempt` on a failure.
 */
export async function findMediaToRefresh(
  db: SqlExecutor,
  limit: number,
  providerIds: readonly string[],
  retryAfterHours = 24,
): Promise<
  { mediaId: string; provider: string; externalId: string; stale: boolean }[]
> {
  // No provider is on, so nothing can be asked.
  if (providerIds.length === 0) return [];
  const { rows } = await db.execute(sql`
    SELECT m.id AS media_id, e.provider::text AS provider, e.external_id,
           (m.fetched_at < now() - make_interval(days => ${refreshAfterDays})) AS stale
    FROM media_items m
    JOIN media_external_ids e ON e.media_id = m.id
    WHERE ${sharedTitleSql("m")}
      -- A provider that is switched off cannot answer: its titles would fill the batch of every
      -- run and keep the others from being refreshed (SAG-179).
      AND e.provider::text IN (${sql.join(
        providerIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND e.updated_at < now() - make_interval(hours => ${retryAfterHours})
      AND (
        m.fetched_at < now() - make_interval(days => ${refreshAfterDays})
        OR NOT jsonb_exists(m.synopsis, 'es') OR NOT jsonb_exists(m.synopsis, 'en')
        OR coalesce(m.titles->>'es', '') = '' OR coalesce(m.titles->>'en', '') = ''
        -- Saved before the length was kept (SAG-61): asked once, and then it is 0 or a number.
        OR (e.provider = 'tmdb' AND m.runtime_minutes IS NULL)
        -- Saved before the genres were kept (SAG-71): asked once, and then it is a list.
        OR m.genres IS NULL
        -- A manga saved before its ids in other catalogs were kept (SAG-16).
        OR (e.provider = 'mangadex' AND m.cross_ids IS NULL)
      )
    ORDER BY (m.fetched_at < now() - make_interval(days => ${refreshAfterDays})) DESC,
             EXISTS (SELECT 1 FROM library_entries le WHERE le.media_id = m.id) DESC,
             m.fetched_at
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    mediaId: String(row.media_id),
    provider: String(row.provider),
    externalId: String(row.external_id),
    stale: row.stale === true,
  }));
}

/** Notes that the provider was asked about a title and gave nothing, so it waits its turn again. */
export async function markRefreshAttempt(
  db: SqlExecutor,
  mediaId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE media_external_ids SET updated_at = now() WHERE media_id = ${mediaId}::uuid
  `);
}

/**
 * Removes what TMDB sent for a title that TMDB no longer has and that is past `refreshAfterDays`
 * (SAG-180, ADR-016): TMDB lets us keep its data for 6 months and there is nothing left to
 * refresh it with. The row, its names and its seasons and episodes stay, so the entries of the
 * libraries that point to it are not lost; the synopsis, authors, length, genres, poster,
 * popularity and the titles and air dates of the parts are emptied. The row is left in the
 * state "asked, nothing known" (empty synopsis in both languages, length 0, no genres) and with
 * `fetched_at` now, so `findMediaToRefresh` asks again only after another `refreshAfterDays`,
 * and a title TMDB has brought back is filled again then.
 */
export async function removeProviderData(
  db: SqlExecutor,
  mediaId: string,
): Promise<void> {
  // The row is changed only while it is still stale: a visit or a search that refreshed it after
  // the job read it keeps its new data.
  await db.execute(sql`
    WITH blanked AS (
      UPDATE media_items SET
        synopsis = '{"es": "", "en": ""}'::jsonb,
        creators = NULL,
        runtime_minutes = 0,
        genres = '[]'::jsonb,
        image_url = NULL,
        popularity = 0,
        fetched_at = now(),
        updated_at = now()
      WHERE id = ${mediaId}::uuid
        AND fetched_at < now() - make_interval(days => ${refreshAfterDays})
      RETURNING id
    )
    UPDATE media_parts SET title = NULL, air_date = NULL, updated_at = now()
    WHERE media_id IN (SELECT id FROM blanked)
  `);
}
