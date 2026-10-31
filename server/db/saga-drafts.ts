import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { mainFormats } from "../providers/wikidata/map";

/** Drafts proposed in one run, so a first run does not bring a flood to review. */
export const draftsPerRun = 3;

/** The most works a draft starts with. An administrator adds or removes from there. */
export const draftMembersLimit = 60;

/**
 * Proposes a draft saga for each media franchise of Wikidata that has at least two titles in our
 * catalog (the titles the Wikidata job matched), when none of its works is in a saga already and
 * no saga came from it before (SAG-92, ADR-026). A draft is never visible to a visitor: only an
 * administrator publishes it. It starts with the franchise's main works (the main formats, the
 * oldest first), is named from the franchise's name in Wikidata, and gets an address from its
 * English name (the franchise's code is added when that address is taken). One statement, and no
 * call to Wikidata: it reads what the job already saved. Returns how many drafts were made.
 */
export async function proposeSagaDrafts(
  db: SqlExecutor,
  limit: number = draftsPerRun,
): Promise<number> {
  const formats = sql.join(
    mainFormats.map((format) => sql`${format}`),
    sql`, `,
  );
  const { rows } = await db.execute(sql`
    WITH candidates AS (
      SELECT l.to_qid AS fqid, count(DISTINCT mw.media_id) AS titles
      FROM media_wikidata mw
      JOIN wikidata_links l ON l.from_qid = mw.qid AND l.relation = 'franchise'
      WHERE mw.qid IS NOT NULL
      GROUP BY l.to_qid
      HAVING count(DISTINCT mw.media_id) >= 2
    ),
    fresh AS (
      SELECT c.fqid, c.titles,
             coalesce(fi.labels->>'en', fi.labels->>'es') AS name_en,
             coalesce(fi.labels->>'es', fi.labels->>'en') AS name_es
      FROM candidates c
      JOIN wikidata_items fi ON fi.qid = c.fqid
      WHERE coalesce(fi.labels->>'en', fi.labels->>'es') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM sagas s WHERE s.franchise_qid = c.fqid)
        AND NOT EXISTS (
          SELECT 1 FROM wikidata_links member
          JOIN saga_wikidata_members sm ON sm.qid = member.from_qid
          WHERE member.to_qid = c.fqid AND member.relation = 'franchise'
        )
      ORDER BY c.titles DESC, c.fqid
      LIMIT ${limit}
    ),
    named AS (
      SELECT f.*,
             trim(both '-' from lower(regexp_replace(
               immutable_unaccent(f.name_en), '[^a-zA-Z0-9]+', '-', 'g'))) AS base
      FROM fresh f
    ),
    created AS (
      INSERT INTO sagas (slug, title, titles, status, origin, franchise_qid)
      SELECT CASE WHEN n.base = '' OR EXISTS (SELECT 1 FROM sagas s WHERE s.slug = n.base)
                  THEN coalesce(nullif(n.base, ''), 'saga') || '-' || lower(n.fqid)
                  ELSE n.base END,
             n.name_en,
             jsonb_build_object('en', n.name_en, 'es', n.name_es),
             'draft', 'wikidata', n.fqid
      FROM named n
      ON CONFLICT DO NOTHING
      RETURNING id, slug, franchise_qid
    ),
    members AS (
      INSERT INTO saga_wikidata_members (saga_id, qid, position)
      SELECT c.id, ranked.qid, ranked.rn - 1
      FROM created c
      CROSS JOIN LATERAL (
        SELECT l.from_qid AS qid,
               (row_number() OVER (ORDER BY i.year NULLS LAST, l.from_qid))::int AS rn
        FROM wikidata_links l
        JOIN wikidata_items i ON i.qid = l.from_qid
        WHERE l.to_qid = c.franchise_qid AND l.relation = 'franchise'
          AND i.format IN (${formats})
      ) ranked
      WHERE ranked.rn <= ${draftMembersLimit}
      RETURNING 1
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT NULL, 'saga.draft_proposed', 'saga', id,
             jsonb_build_object('slug', slug, 'franchise', franchise_qid)
      FROM created
    )
    SELECT (SELECT count(*) FROM created)::int AS created
  `);
  return Number(rows[0]?.created ?? 0);
}
