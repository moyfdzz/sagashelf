import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { SagaMember } from "./sagas";
import type { LocalizedText } from "./schema/shared";
import { mediaMatchesItem } from "./wikidata-store";
import { type Genre, isGenre } from "../providers/genres";
import { isWikidataFormat } from "../providers/wikidata/map";
import type { Locale, MediaKind } from "../providers/types";
import { localizedTitleSql } from "./titles";

/**
 * What the recommendations page reads (SAG-87, ADR-028). Both queries read the library of the person
 * of the verified session, whose id comes from the session and never from the address, and the
 * catalog, which holds data of the providers and no one's library: a title appears in a
 * recommendation because of its genres or its saga, never because of what somebody else has.
 */

/** How many titles of the genres are offered. */
export const genreLimit = 20;

/** A title of the catalog that fits the genres a person likes. */
export type GenreRecommendation = {
  mediaId: string;
  type: MediaKind;
  title: string;
  year: number | null;
  /** The genres of the person that this title has, the ones they like most first. */
  because: Genre[];
};

export type GenreRecommendations = {
  /** How many genres the person likes. With none, there is nothing to recommend by. */
  likedGenres: number;
  items: GenreRecommendation[];
};

/**
 * The titles of the catalog that the person does not have in their library, by how well their genres
 * fit the ones the person likes. A genre is liked by what the person did with the titles that have it
 * (planned ones say nothing): each score adds its distance from 5 over 5 (a 10 is +1, a 3 is -0.4); a
 * title with no score adds 0.5 when completed, 0.2 when in progress or paused, and takes 0.3 away
 * when dropped. A genre whose sum is not above zero is not liked. A title's affinity is the sum of the
 * liked genres it has divided by the square root of its genres, so a title with many genres does not
 * win only for having them. Ties go to the more popular title.
 */
export async function getGenreRecommendations(
  db: SqlExecutor,
  userId: string,
  locale: Locale,
  limit: number = genreLimit,
): Promise<GenreRecommendations> {
  const { rows } = await db.execute(sql`
    WITH weighed AS (
      SELECT g.genre AS genre,
             sum(CASE WHEN le.score IS NOT NULL THEN (le.score - 5)::float8 / 5
                      WHEN le.status = 'completed' THEN 0.5
                      WHEN le.status = 'dropped' THEN -0.3
                      ELSE 0.2 END) AS w
      FROM library_entries le
      JOIN media_items mi ON mi.id = le.media_id
      CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(mi.genres, '[]'::jsonb)) AS g(genre)
      WHERE le.user_id = ${userId}::uuid AND le.status <> 'planned'
      GROUP BY g.genre
    ),
    liked AS (SELECT genre, w FROM weighed WHERE w > 0),
    scored AS (
      SELECT m.id, m.type::text AS type, ${localizedTitleSql("m", locale)} AS title, m.year,
             m.popularity,
             sum(l.w) / sqrt(jsonb_array_length(m.genres)) AS affinity,
             jsonb_agg(l.genre ORDER BY l.w DESC, l.genre) AS because
      FROM media_items m
      JOIN liked l ON jsonb_exists(m.genres, l.genre)
      WHERE m.type <> 'custom'
        AND NOT EXISTS (
          SELECT 1 FROM library_entries own
          WHERE own.user_id = ${userId}::uuid AND own.media_id = m.id
        )
      GROUP BY m.id
      ORDER BY affinity DESC, m.popularity DESC, m.id
      LIMIT ${limit}
    )
    SELECT (SELECT count(*)::int FROM liked) AS liked_genres,
           s.id, s.type, s.title, s.year, s.because
    FROM (SELECT 1) AS one
    LEFT JOIN scored s ON true
    ORDER BY s.affinity DESC NULLS LAST, s.popularity DESC NULLS LAST, s.id
  `);
  return {
    likedGenres: Number(rows[0]?.liked_genres ?? 0),
    items: rows.flatMap((row) =>
      row.id
        ? [
            {
              mediaId: String(row.id),
              type: row.type as MediaKind,
              title: String(row.title),
              year: typeof row.year === "number" ? row.year : null,
              because: ((row.because as unknown[] | null) ?? []).filter(
                isGenre,
              ),
            },
          ]
        : [],
    ),
  };
}

/** The works of a published saga that the person has not got in their library. */
export type SagaSuggestion = {
  slug: string;
  title: string;
  titles: LocalizedText;
  /** In the order of the story. */
  missing: SagaMember[];
};

/**
 * For every published saga in which the person has at least one entry, the works they do not have in
 * their library, in the order of the story. A work of the saga is matched to the catalog like on the
 * page of the saga (`mediaMatchesItem`); one the catalog does not hold cannot be in a library, so
 * it is always missing. A draft is never read.
 */
export async function getSagaSuggestions(
  db: SqlExecutor,
  userId: string,
): Promise<SagaSuggestion[]> {
  const { rows } = await db.execute(sql`
    WITH members AS (
      SELECT s.id AS saga_id, s.slug, s.title AS saga_title, s.titles AS saga_titles,
             sm.position, i.qid, i.format, i.labels, i.year,
             matched.id AS media_id, matched.type AS media_type,
             matched.title AS media_title, matched.titles AS media_titles
      FROM sagas s
      JOIN saga_wikidata_members sm ON sm.saga_id = s.id
      JOIN wikidata_items i ON i.qid = sm.qid AND i.details_at IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT m.id, m.type::text AS type, m.title, m.titles
        FROM media_items m
        WHERE m.type <> 'custom' AND ${mediaMatchesItem}
        ORDER BY m.id
        LIMIT 1
      ) matched ON true
      WHERE s.status = 'published'
    ),
    started AS (
      SELECT DISTINCT m.saga_id
      FROM members m
      JOIN library_entries le ON le.media_id = m.media_id AND le.user_id = ${userId}::uuid
    )
    SELECT m.*
    FROM members m
    JOIN started st ON st.saga_id = m.saga_id
    WHERE m.media_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM library_entries own
         WHERE own.user_id = ${userId}::uuid AND own.media_id = m.media_id
       )
    ORDER BY m.slug, m.position
  `);

  const sagas = new Map<string, SagaSuggestion>();
  for (const row of rows) {
    const slug = String(row.slug);
    const suggestion = sagas.get(slug) ?? {
      slug,
      title: String(row.saga_title),
      titles: (row.saga_titles as LocalizedText | null) ?? {},
      missing: [],
    };
    suggestion.missing.push({
      qid: String(row.qid),
      format: isWikidataFormat(row.format) ? row.format : "other",
      labels: (row.labels as LocalizedText | null) ?? {},
      year: typeof row.year === "number" ? row.year : null,
      position: Number(row.position),
      media: row.media_id
        ? {
            id: String(row.media_id),
            type: row.media_type as MediaKind,
            title: String(row.media_title),
            titles: (row.media_titles as LocalizedText | null) ?? {},
          }
        : null,
    });
    sagas.set(slug, suggestion);
  }
  return [...sagas.values()];
}
