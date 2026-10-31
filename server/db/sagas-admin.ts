import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { LocalizedText } from "./schema/shared";
import {
  isWikidataFormat,
  type WikidataFormat,
} from "../providers/wikidata/map";

/**
 * What the curation screen reads and writes (SAG-92, ADR-026). Every write is one statement that
 * also adds its row to `audit_log` (who, what, which saga; never a token or an address), so a change
 * and its record are kept together or not at all. Any edit makes the saga the screen's own
 * (`origin = 'admin'`): the curated file never saves it over again.
 */

export type SagaStatus = "draft" | "published";
export type SagaOrigin = "file" | "admin" | "wikidata";

export type AdminSaga = {
  id: string;
  slug: string;
  title: string;
  titles: LocalizedText;
  status: SagaStatus;
  origin: SagaOrigin;
  members: number;
  /** The members Wikidata has described, which are the ones a visitor sees. */
  described: number;
};

const statusOf = (value: unknown): SagaStatus =>
  value === "draft" ? "draft" : "published";
const originOf = (value: unknown): SagaOrigin =>
  value === "admin" || value === "wikidata" ? value : "file";

/** Every saga, the drafts first, so what waits for review is at the top. */
export async function listSagasForAdmin(db: SqlExecutor): Promise<AdminSaga[]> {
  const { rows } = await db.execute(sql`
    SELECT s.id, s.slug, s.title, s.titles, s.status, s.origin,
           (SELECT count(*)::int FROM saga_wikidata_members m WHERE m.saga_id = s.id) AS members,
           (SELECT count(*)::int FROM saga_wikidata_members m
              JOIN wikidata_items i ON i.qid = m.qid AND i.details_at IS NOT NULL
              WHERE m.saga_id = s.id) AS described
    FROM sagas s
    ORDER BY (s.status = 'draft') DESC, s.slug
  `);
  return rows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    titles: (row.titles as LocalizedText | null) ?? {},
    status: statusOf(row.status),
    origin: originOf(row.origin),
    members: Number(row.members),
    described: Number(row.described),
  }));
}

export type AdminSagaMember = {
  qid: string;
  position: number;
  /** Null until the cron has described the item. */
  format: WikidataFormat | null;
  labels: LocalizedText;
  year: number | null;
};

export type AdminSagaPage = {
  saga: Omit<AdminSaga, "members" | "described">;
  members: AdminSagaMember[];
};

/** One saga with all its members, in the order of the story, whether Wikidata described them or not. */
export async function getSagaForAdmin(
  db: SqlExecutor,
  id: string,
): Promise<AdminSagaPage | null> {
  const { rows } = await db.execute(sql`
    SELECT s.id, s.slug, s.title, s.titles, s.status, s.origin,
           m.qid, m.position, i.format, i.labels, i.year, i.details_at
    FROM sagas s
    LEFT JOIN saga_wikidata_members m ON m.saga_id = s.id
    LEFT JOIN wikidata_items i ON i.qid = m.qid
    WHERE s.id = ${id}::uuid
    ORDER BY m.position NULLS LAST, m.qid
  `);
  const first = rows[0];
  if (!first) return null;
  return {
    saga: {
      id: String(first.id),
      slug: String(first.slug),
      title: String(first.title),
      titles: (first.titles as LocalizedText | null) ?? {},
      status: statusOf(first.status),
      origin: originOf(first.origin),
    },
    members: rows.flatMap((row) =>
      row.qid
        ? [
            {
              qid: String(row.qid),
              position: Number(row.position),
              format:
                row.details_at && isWikidataFormat(row.format)
                  ? row.format
                  : null,
              labels: row.details_at
                ? ((row.labels as LocalizedText | null) ?? {})
                : {},
              year: typeof row.year === "number" ? row.year : null,
            },
          ]
        : [],
    ),
  };
}

/** Creates a draft that only an administrator sees. Null when the address (slug) is taken. */
export async function createSaga(
  db: SqlExecutor,
  input: { slug: string; titles: { es: string; en: string }; actorId: string },
): Promise<string | null> {
  const { rows } = await db.execute(sql`
    WITH created AS (
      INSERT INTO sagas (slug, title, titles, status, origin)
      VALUES (${input.slug}, ${input.titles.en}, ${JSON.stringify(input.titles)}::jsonb,
              'draft', 'admin')
      ON CONFLICT (slug) DO NOTHING
      RETURNING id, slug
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${input.actorId}::uuid, 'saga.create', 'saga', id,
             jsonb_build_object('slug', slug)
      FROM created
    )
    SELECT id FROM created
  `);
  return rows[0]?.id ? String(rows[0].id) : null;
}

/** Publishes or unpublishes a saga. False when there is no such saga. */
export async function setSagaStatus(
  db: SqlExecutor,
  id: string,
  status: SagaStatus,
  actorId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH changed AS (
      UPDATE sagas SET status = ${status}, origin = 'admin', updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, slug
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid,
             CASE WHEN ${status} = 'published' THEN 'saga.publish' ELSE 'saga.unpublish' END,
             'saga', id, jsonb_build_object('slug', slug)
      FROM changed
    )
    SELECT count(*)::int AS changed FROM changed
  `);
  return Number(rows[0]?.changed) > 0;
}

/** Changes the names of a saga, never its address. False when there is no such saga. */
export async function renameSaga(
  db: SqlExecutor,
  id: string,
  titles: { es: string; en: string },
  actorId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH changed AS (
      UPDATE sagas SET title = ${titles.en}, titles = ${JSON.stringify(titles)}::jsonb,
                       origin = 'admin', updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id, slug
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'saga.rename', 'saga', id, jsonb_build_object('slug', slug)
      FROM changed
    )
    SELECT count(*)::int AS changed FROM changed
  `);
  return Number(rows[0]?.changed) > 0;
}

/** Adds a work at the end of the story. `found` says the saga exists, `added` that the work was new. */
export async function addSagaMember(
  db: SqlExecutor,
  id: string,
  qid: string,
  actorId: string,
): Promise<{ found: boolean; added: boolean }> {
  const { rows } = await db.execute(sql`
    WITH target AS (SELECT id FROM sagas WHERE id = ${id}::uuid),
    added AS (
      INSERT INTO saga_wikidata_members (saga_id, qid, position)
      SELECT t.id, ${qid},
             coalesce((SELECT max(position) + 1 FROM saga_wikidata_members
                       WHERE saga_id = t.id), 0)
      FROM target t
      ON CONFLICT (saga_id, qid) DO NOTHING
      RETURNING saga_id
    ),
    touched AS (
      UPDATE sagas SET origin = 'admin', updated_at = now()
      WHERE id IN (SELECT saga_id FROM added)
      RETURNING id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'saga.member_add', 'saga', saga_id,
             jsonb_build_object('qid', ${qid}::text)
      FROM added
    )
    SELECT (SELECT count(*) FROM target)::int AS found,
           (SELECT count(*) FROM added)::int AS added
  `);
  return {
    found: Number(rows[0]?.found) > 0,
    added: Number(rows[0]?.added) > 0,
  };
}

/** Takes a work out of a saga. False when the saga did not have it. */
export async function removeSagaMember(
  db: SqlExecutor,
  id: string,
  qid: string,
  actorId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH removed AS (
      DELETE FROM saga_wikidata_members WHERE saga_id = ${id}::uuid AND qid = ${qid}
      RETURNING saga_id
    ),
    touched AS (
      UPDATE sagas SET origin = 'admin', updated_at = now()
      WHERE id IN (SELECT saga_id FROM removed)
      RETURNING id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'saga.member_remove', 'saga', saga_id,
             jsonb_build_object('qid', ${qid}::text)
      FROM removed
    )
    SELECT count(*)::int AS removed FROM removed
  `);
  return Number(rows[0]?.removed) > 0;
}

/**
 * Moves a work one place up or down by swapping its position with its neighbour's. False when
 * there is nothing to swap with (it is already first or last, or the saga does not have it).
 */
export async function moveSagaMember(
  db: SqlExecutor,
  id: string,
  qid: string,
  direction: "up" | "down",
  actorId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH ordered AS (
      SELECT qid, position,
             lag(qid) OVER w AS prev_qid, lead(qid) OVER w AS next_qid
      FROM saga_wikidata_members
      WHERE saga_id = ${id}::uuid
      WINDOW w AS (ORDER BY position, qid)
    ),
    me AS (SELECT * FROM ordered WHERE qid = ${qid}),
    other AS (
      SELECT o.qid, o.position FROM ordered o JOIN me
        ON o.qid = (CASE WHEN ${direction}::text = 'up' THEN me.prev_qid ELSE me.next_qid END)
    ),
    moved AS (
      UPDATE saga_wikidata_members m
      SET position = CASE WHEN m.qid = ${qid} THEN (SELECT position FROM other)
                          ELSE (SELECT position FROM me) END,
          updated_at = now()
      WHERE m.saga_id = ${id}::uuid
        AND m.qid IN (${qid}, (SELECT qid FROM other))
        AND EXISTS (SELECT 1 FROM other)
      RETURNING 1
    ),
    touched AS (
      UPDATE sagas SET origin = 'admin', updated_at = now()
      WHERE id = ${id}::uuid AND EXISTS (SELECT 1 FROM moved)
      RETURNING id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'saga.member_move', 'saga', id,
             jsonb_build_object('qid', ${qid}::text, 'direction', ${direction}::text)
      FROM touched
    )
    SELECT count(*)::int AS moved FROM moved
  `);
  return Number(rows[0]?.moved) > 0;
}
