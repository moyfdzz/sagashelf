import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { Locale, MediaKind, ProviderId } from "../providers/types";
import type { LocalizedText } from "./schema/shared";
import { localizedTitleSql } from "./titles";

/** A title from our own database, with how well it matched. */
export type LocalHit = {
  id: string;
  type: MediaKind;
  /** In the language of the visitor when we hold it. */
  title: string;
  originalTitle: string | null;
  year: number | null;
  synopsis: LocalizedText;
  imageUrl: string | null;
  popularity: number;
  provider: ProviderId;
  externalId: string;
  exact: boolean;
  similarity: number;
};

/**
 * The query as a `tsquery` for the 'simple' configuration: every word must be there and the last
 * one may be unfinished ("one pie" finds "One Piece"), which is what a person typing needs.
 * Only letters and digits survive, so the text cannot add operators to the query.
 */
export function toTsQuery(normalizedQuery: string): string {
  const words = normalizedQuery
    .split(" ")
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return words
    .map((word, index) => (index === words.length - 1 ? `${word}:*` : word))
    .join(" & ");
}

/**
 * Looks for the query in the titles we already hold: a full-text match (the last word may be
 * unfinished), or titles that are close by trigram similarity (so "pokemn" finds "Pokémon"),
 * both without accents. Exact titles first, then the closest, then the most popular. Titles that
 * people made themselves (`custom`) are private and never come out of here. The title that comes
 * back is the one in `locale`; what is matched is still `title` and `original_title`.
 * `normalizedQuery` comes from `normalizeQuery`.
 */
export async function searchLocal(
  db: SqlExecutor,
  normalizedQuery: string,
  type: MediaKind | undefined,
  locale: Locale,
  limit = 20,
): Promise<LocalHit[]> {
  const tsQuery = toTsQuery(normalizedQuery);
  if (tsQuery === "") return [];

  const { rows } = await db.execute(sql`
    SELECT m.id, m.type::text AS type, ${localizedTitleSql("m", locale)} AS title,
           m.original_title, m.year, m.synopsis,
           m.image_url, m.popularity, e.provider::text AS provider, e.external_id,
           (
             immutable_unaccent(lower(m.title)) = ${normalizedQuery}
             OR immutable_unaccent(lower(coalesce(m.original_title, ''))) = ${normalizedQuery}
           ) AS exact,
           GREATEST(
             similarity(immutable_unaccent(lower(m.title)), ${normalizedQuery}),
             similarity(immutable_unaccent(lower(coalesce(m.original_title, ''))), ${normalizedQuery})
           ) AS similarity
    FROM media_items m
    JOIN LATERAL (
      SELECT provider, external_id FROM media_external_ids
      WHERE media_id = m.id ORDER BY created_at LIMIT 1
    ) e ON true
    WHERE m.type <> 'custom'
      AND (${type ?? null}::media_type IS NULL OR m.type = ${type ?? null}::media_type)
      AND (
        m.search_vector @@ to_tsquery('simple', ${tsQuery})
        OR immutable_unaccent(lower(m.title)) % ${normalizedQuery}
        OR immutable_unaccent(lower(coalesce(m.original_title, ''))) % ${normalizedQuery}
      )
    ORDER BY exact DESC, similarity DESC, m.popularity DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: String(row.id),
    type: row.type as MediaKind,
    title: String(row.title),
    originalTitle: (row.original_title as string | null) ?? null,
    year: (row.year as number | null) ?? null,
    synopsis: (row.synopsis as LocalizedText | null) ?? {},
    imageUrl: (row.image_url as string | null) ?? null,
    popularity: Number(row.popularity),
    provider: row.provider as ProviderId,
    externalId: String(row.external_id),
    exact: row.exact === true,
    similarity: Number(row.similarity),
  }));
}
