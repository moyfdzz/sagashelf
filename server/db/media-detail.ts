import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { MediaKind, MediaStatus, ProviderId } from "../providers/types";
import type { LocalizedText } from "./schema/shared";

export type MediaEpisode = {
  number: number;
  title: string | null;
  airDate: string | null;
};

export type MediaSeason = {
  number: number;
  title: string | null;
  airDate: string | null;
  episodes: MediaEpisode[];
};

/** One title as the detail page shows it. */
export type MediaDetail = {
  id: string;
  type: MediaKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  synopsis: LocalizedText;
  imageUrl: string | null;
  status: MediaStatus;
  fetchedAt: Date;
  provider: ProviderId;
  externalId: string;
  seasons: MediaSeason[];
};

type PartRow = {
  kind: string;
  number: number;
  title: string | null;
  air_date: string | null;
  season: number | null;
};

/**
 * One title with its first external id and its seasons and episodes, or null when there is none
 * (or when it is a `custom` title: those are private and have no public page).
 */
export async function getMediaDetail(
  db: SqlExecutor,
  id: string,
): Promise<MediaDetail | null> {
  const { rows } = await db.execute(sql`
    SELECT m.id, m.type::text AS type, m.title, m.original_title, m.year, m.synopsis,
           m.image_url, m.status::text AS status, m.fetched_at,
           e.provider::text AS provider, e.external_id,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'kind', p.kind::text, 'number', p.number, 'title', p.title,
                      'air_date', p.air_date::text, 'season', s.number)
                    ORDER BY (p.kind = 'episode'), s.number NULLS FIRST, p.number)
             FROM media_parts p LEFT JOIN media_parts s ON s.id = p.parent_id
             WHERE p.media_id = m.id
           ), '[]'::jsonb) AS parts
    FROM media_items m
    JOIN LATERAL (
      SELECT provider, external_id FROM media_external_ids
      WHERE media_id = m.id ORDER BY created_at LIMIT 1
    ) e ON true
    WHERE m.id = ${id}::uuid AND m.type <> 'custom'
  `);
  const row = rows[0];
  if (!row) return null;

  const parts = row.parts as PartRow[];
  const seasons: MediaSeason[] = parts
    .filter((part) => part.kind === "season")
    .map((part) => ({
      number: part.number,
      title: part.title,
      airDate: part.air_date,
      episodes: [],
    }));
  for (const part of parts) {
    if (part.kind !== "episode") continue;
    seasons
      .find((season) => season.number === part.season)
      ?.episodes.push({
        number: part.number,
        title: part.title,
        airDate: part.air_date,
      });
  }

  return {
    id: String(row.id),
    type: row.type as MediaKind,
    title: String(row.title),
    originalTitle: (row.original_title as string | null) ?? null,
    year: (row.year as number | null) ?? null,
    synopsis: (row.synopsis as LocalizedText) ?? {},
    imageUrl: (row.image_url as string | null) ?? null,
    status: row.status as MediaStatus,
    fetchedAt: new Date(String(row.fetched_at)),
    provider: row.provider as ProviderId,
    externalId: String(row.external_id),
    seasons,
  };
}

/** The id of the title that holds this source id, or null when we do not hold it yet. */
export async function findMediaByExternalId(
  db: SqlExecutor,
  provider: string,
  externalId: string,
): Promise<{ id: string; type: MediaKind; title: string } | null> {
  const { rows } = await db.execute(sql`
    SELECT m.id, m.type::text AS type, m.title
    FROM media_external_ids e JOIN media_items m ON m.id = e.media_id
    WHERE e.provider = ${provider}::external_provider AND e.external_id = ${externalId}
      AND m.type <> 'custom'
  `);
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        type: row.type as MediaKind,
        title: String(row.title),
      }
    : null;
}
