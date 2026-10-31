import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { LocalizedText } from "./schema/shared";
import { mediaMatchesItem } from "./wikidata-store";
import {
  isWikidataFormat,
  type WikidataFormat,
} from "../providers/wikidata/map";
import type { MediaKind } from "../providers/types";

/** What the sync has to do for the curated sagas: the ones to save and the items to describe. */
export type SagaSyncWork = { changedSlugs: string[]; missingQids: string[] };

/**
 * The curated sagas whose entry changed since they were saved, and the items of their members
 * that the members query has not described yet (no year). One query, so a run with nothing to do
 * costs one subrequest. A saga that an administrator edited, or that Wikidata suggested, belongs to
 * the screen (SAG-92): the file never saves it again. The works to describe are those of every
 * saga, so one an administrator added by hand is described too.
 */
export async function findSagaSyncWork(
  db: SqlExecutor,
  sagas: readonly { slug: string; hash: string }[],
  qids: readonly string[],
): Promise<SagaSyncWork> {
  const { rows } = await db.execute(sql`
    SELECT 'saga' AS kind, x.slug AS value
    FROM jsonb_to_recordset(${JSON.stringify(sagas)}::jsonb) AS x(slug text, hash text)
    LEFT JOIN sagas s ON s.slug = x.slug
    WHERE (s.id IS NULL OR s.origin = 'file') AND s.source_hash IS DISTINCT FROM x.hash
    UNION ALL
    SELECT 'item', q.qid
    FROM (
      SELECT jsonb_array_elements_text(${JSON.stringify(qids)}::jsonb) AS qid
      UNION
      SELECT qid FROM saga_wikidata_members
    ) AS q
    LEFT JOIN wikidata_items i ON i.qid = q.qid
    WHERE i.details_at IS NULL
    ORDER BY 1, 2
  `);
  const valuesOf = (kind: string) =>
    rows.filter((row) => row.kind === kind).map((row) => String(row.value));
  return { changedSlugs: valuesOf("saga"), missingQids: valuesOf("item") };
}

export type SagaToSave = {
  slug: string;
  titles: { es: string; en: string };
  hash: string;
  members: readonly string[];
};

/**
 * Saves the sagas and their members in one statement: a saga is created or updated, its members
 * are added or moved to their new position, and the ones that are no longer listed are removed.
 */
export async function saveSagas(
  db: SqlExecutor,
  sagas: readonly SagaToSave[],
): Promise<void> {
  if (sagas.length === 0) return;
  const payload = JSON.stringify(
    sagas.map((saga) => ({
      slug: saga.slug,
      title: saga.titles.en,
      titles: saga.titles,
      hash: saga.hash,
      members: saga.members,
    })),
  );
  await db.execute(sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
        AS x(slug text, title text, titles jsonb, hash text, members jsonb)
    ),
    saved AS (
      INSERT INTO sagas (slug, title, titles, source_hash)
      SELECT slug, title, titles, hash FROM input
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title, titles = EXCLUDED.titles,
        source_hash = EXCLUDED.source_hash, updated_at = now()
      -- What an administrator edited, or Wikidata suggested, is never saved over (SAG-92).
      WHERE sagas.origin = 'file'
      RETURNING id, slug
    ),
    wanted AS (
      SELECT s.id AS saga_id, m.qid, (m.ord - 1)::int AS position
      FROM input i
      JOIN saved s ON s.slug = i.slug
      CROSS JOIN LATERAL jsonb_array_elements_text(i.members) WITH ORDINALITY AS m(qid, ord)
    ),
    removed AS (
      DELETE FROM saga_wikidata_members m USING saved s
      WHERE m.saga_id = s.id
        AND NOT EXISTS (SELECT 1 FROM wanted w WHERE w.saga_id = m.saga_id AND w.qid = m.qid)
      RETURNING 1
    )
    INSERT INTO saga_wikidata_members (saga_id, qid, position)
    SELECT saga_id, qid, position FROM wanted
    ON CONFLICT (saga_id, qid) DO UPDATE SET position = EXCLUDED.position, updated_at = now()
  `);
}

/** One work of a saga: what Wikidata says, and the title of our catalog when we hold it. */
export type SagaMember = {
  qid: string;
  format: WikidataFormat;
  labels: LocalizedText;
  year: number | null;
  /** The place in the story as curated, counting from 0. */
  position: number;
  media: {
    id: string;
    type: MediaKind;
    title: string;
    titles: LocalizedText;
  } | null;
};

export type SagaPage = {
  id: string;
  slug: string;
  title: string;
  titles: LocalizedText;
  members: SagaMember[];
};

/**
 * A saga with its members, or null when there is no such saga or none of its works has been
 * described yet (a page with no works would say nothing). Each member carries the title of our
 * catalog that it matches.
 */
export async function getSagaBySlug(
  db: SqlExecutor,
  slug: string,
): Promise<SagaPage | null> {
  const { rows } = await db.execute(sql`
    SELECT s.id AS saga_id, s.slug, s.title AS saga_title, s.titles AS saga_titles,
           i.qid, i.format, i.labels, i.year, m.position,
           matched.id AS media_id, matched.type AS media_type, matched.title AS media_title,
           matched.titles AS media_titles
    FROM sagas s
    JOIN saga_wikidata_members m ON m.saga_id = s.id
    JOIN wikidata_items i ON i.qid = m.qid AND i.details_at IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT m.id, m.type::text AS type, m.title, m.titles
      FROM media_items m
      WHERE m.type <> 'custom' AND ${mediaMatchesItem}
      ORDER BY m.id
      LIMIT 1
    ) matched ON true
    WHERE s.slug = ${slug} AND s.status = 'published'
    ORDER BY m.position
  `);
  const first = rows[0];
  if (!first) return null;
  return {
    id: String(first.saga_id),
    slug: String(first.slug),
    title: String(first.saga_title),
    titles: (first.saga_titles as LocalizedText | null) ?? {},
    members: rows.map((row) => ({
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
    })),
  };
}

/** The sagas a title is part of, for the badge of its page. */
export async function getSagasOfMedia(
  db: SqlExecutor,
  mediaId: string,
): Promise<{ slug: string; title: string; titles: LocalizedText }[]> {
  const { rows } = await db.execute(sql`
    SELECT DISTINCT s.slug, s.title, s.titles
    FROM saga_wikidata_members sm
    JOIN wikidata_items i ON i.qid = sm.qid
    JOIN sagas s ON s.id = sm.saga_id
    JOIN media_items m ON m.id = ${mediaId}::uuid AND m.type <> 'custom'
    WHERE s.status = 'published' AND ${mediaMatchesItem}
    ORDER BY s.slug
  `);
  return rows.map((row) => ({
    slug: String(row.slug),
    title: String(row.title),
    titles: (row.titles as LocalizedText | null) ?? {},
  }));
}

/** What a person has done with one title of a saga. */
export type SagaProgress = {
  status: string;
  progress: number;
  /** The units that count as the end: pages, chapters or volumes of the edition, or the episodes. */
  total: number | null;
};

/**
 * The entries of this person for these titles, with the total that tells how far they are. The
 * id of the person comes from the session. A title they do not hold is not in the answer.
 */
export async function getSagaProgress(
  db: SqlExecutor,
  userId: string,
  mediaIds: readonly string[],
): Promise<Map<string, SagaProgress>> {
  if (mediaIds.length === 0) return new Map();
  const ids = sql.join(
    mediaIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const { rows } = await db.execute(sql`
    SELECT le.media_id, le.status::text AS status, le.progress,
           coalesce(le.progress_total, nullif((
             SELECT count(*)::int FROM media_parts p
             JOIN media_parts s ON s.id = p.parent_id
             WHERE p.media_id = le.media_id AND p.kind = 'episode' AND s.number > 0
           ), 0)) AS total
    FROM library_entries le
    WHERE le.user_id = ${userId}::uuid AND le.media_id IN (${ids})
  `);
  return new Map(
    rows.map((row) => [
      String(row.media_id),
      {
        status: String(row.status),
        progress: Number(row.progress),
        total: row.total === null ? null : Number(row.total),
      },
    ]),
  );
}
