import { sql } from "drizzle-orm";

import type { Locale } from "../providers/types";
import { maxListItems } from "../lists/schema";
import type { SqlExecutor } from "./clerk-sync";
import { localizedTitleSql, sharedTitleSql } from "./titles";

/**
 * The titles inside a list of the person (SAG-113, ADR-045). Like `lists.ts`, every function is one
 * statement and every one joins the list to the id of the person of the session: a list that is not
 * theirs behaves as a list that is not there, and a title of a list of someone else cannot be moved,
 * noted or removed by guessing its id.
 */

export type ListItem = {
  mediaId: string;
  type: string;
  title: string;
  year: number | null;
  imageUrl: string | null;
  note: string | null;
};

/** The titles of one list of the person in the order they chose, or none for a list that is not theirs. */
export async function listItemsOf(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  locale: Locale,
): Promise<ListItem[]> {
  const { rows } = await db.execute(sql`
    SELECT i.media_id, i.note, m.type, m.year, m.image_url,
           ${localizedTitleSql("m", locale)} AS title
    FROM list_items i
    JOIN lists l ON l.id = i.list_id
    JOIN media_items m ON m.id = i.media_id
    WHERE i.list_id = ${listId}::uuid AND l.owner_id = ${ownerId}::uuid
    ORDER BY i.position, i.created_at, i.media_id
  `);
  return rows.map((row) => ({
    mediaId: String(row.media_id),
    type: String(row.type),
    title: String(row.title),
    year: row.year == null ? null : Number(row.year),
    imageUrl: row.image_url ? String(row.image_url) : null,
    note: row.note ? String(row.note) : null,
  }));
}

export type TitleList = {
  id: string;
  title: string;
  /** Whether the title is already in it. */
  has: boolean;
};

/** The lists of the person, with whether this title is in each, for the button "Add to a list". */
export async function listsForTitle(
  db: SqlExecutor,
  ownerId: string,
  mediaId: string,
): Promise<TitleList[]> {
  const { rows } = await db.execute(sql`
    SELECT l.id, l.title,
           EXISTS (
             SELECT 1 FROM list_items i WHERE i.list_id = l.id AND i.media_id = ${mediaId}::uuid
           ) AS has
    FROM lists l
    WHERE l.owner_id = ${ownerId}::uuid
    ORDER BY lower(l.title), l.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    has: row.has === true,
  }));
}

export type AddItemResult = "added" | "already" | "limit" | "not_found";

/**
 * Puts a title at the end of a list of the person. The ownership, the limit, the existence of the
 * title and the insert are one statement. A title that a person made for themselves can only go in
 * their own lists. `ON CONFLICT DO NOTHING` has no target on purpose (ADR-043): a title already in the
 * list inserts nothing and is answered "already". The limit is soft like the one of the lists.
 */
export async function addListItem(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  mediaId: string,
): Promise<AddItemResult> {
  const { rows } = await db.execute(sql`
    WITH mine AS (
      SELECT id FROM lists WHERE id = ${listId}::uuid AND owner_id = ${ownerId}::uuid
    ),
    found AS (
      SELECT m.id FROM media_items m
      WHERE m.id = ${mediaId}::uuid
        -- A person may put their own custom title in their own list: the one place that goes
        -- around the shared rule on purpose. When SAG-19 changes the rule, revisit this clause.
        AND (${sharedTitleSql("m")} OR EXISTS (
          SELECT 1 FROM custom_entries c WHERE c.media_id = m.id AND c.owner_id = ${ownerId}::uuid
        ))
    ),
    held AS (
      SELECT count(*)::int AS n, coalesce(max(position), -1) AS last
      FROM list_items WHERE list_id = ${listId}::uuid
    ),
    inserted AS (
      INSERT INTO list_items (list_id, media_id, position)
      SELECT ${listId}::uuid, found.id, held.last + 1
      FROM mine, found, held
      WHERE held.n < ${maxListItems}::int
      ON CONFLICT DO NOTHING
      RETURNING media_id
    ),
    touched AS (
      UPDATE lists SET updated_at = now()
      WHERE id IN (SELECT id FROM mine) AND EXISTS (SELECT 1 FROM inserted)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM mine)::int AS mine,
           (SELECT count(*) FROM found)::int AS found,
           (SELECT count(*) FROM inserted)::int AS inserted,
           (SELECT n FROM held) AS held,
           EXISTS (
             SELECT 1 FROM list_items
             WHERE list_id = ${listId}::uuid AND media_id = ${mediaId}::uuid
           ) AS present
  `);
  const row = rows[0];
  if (Number(row?.mine) !== 1 || Number(row?.found) !== 1) return "not_found";
  if (Number(row?.inserted) === 1) return "added";
  // A title already in a full list is "already": the limit is not what stopped it.
  if (row?.present === true) return "already";
  return Number(row?.held) >= maxListItems ? "limit" : "already";
}

/** Takes a title out of a list of the person. False when the list or the title is not there. */
export async function removeListItem(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  mediaId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH mine AS (
      SELECT id FROM lists WHERE id = ${listId}::uuid AND owner_id = ${ownerId}::uuid
    ),
    removed AS (
      DELETE FROM list_items
      WHERE list_id = ${listId}::uuid AND media_id = ${mediaId}::uuid
        AND EXISTS (SELECT 1 FROM mine)
      RETURNING media_id
    ),
    touched AS (
      UPDATE lists SET updated_at = now()
      WHERE id IN (SELECT id FROM mine) AND EXISTS (SELECT 1 FROM removed)
      RETURNING id
    )
    SELECT count(*)::int AS removed FROM removed
  `);
  return Number(rows[0]?.removed) === 1;
}

/** Writes the note of a title of a list of the person; null clears it. False when it is not there. */
export async function saveListItemNote(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  mediaId: string,
  note: string | null,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH mine AS (
      SELECT id FROM lists WHERE id = ${listId}::uuid AND owner_id = ${ownerId}::uuid
    ),
    changed AS (
      UPDATE list_items SET note = ${note}::text, updated_at = now()
      WHERE list_id = ${listId}::uuid AND media_id = ${mediaId}::uuid
        AND EXISTS (SELECT 1 FROM mine)
      RETURNING media_id
    ),
    touched AS (
      UPDATE lists SET updated_at = now()
      WHERE id IN (SELECT id FROM mine) AND EXISTS (SELECT 1 FROM changed)
      RETURNING id
    )
    SELECT count(*)::int AS changed FROM changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/**
 * Moves a title one place up or down in a list of the person, by swapping it with its neighbour.
 * The order is numbered again from 0 inside the statement (`position`, then `created_at`, then the id),
 * so titles that share a position still end up in a clear order. A title already at the end it is moved
 * towards stays where it is, and that is not an error. False when the list or the title is not there.
 */
export async function moveListItem(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  mediaId: string,
  direction: "up" | "down",
): Promise<boolean> {
  const step = direction === "up" ? -1 : 1;
  const { rows } = await db.execute(sql`
    WITH mine AS (
      SELECT id FROM lists WHERE id = ${listId}::uuid AND owner_id = ${ownerId}::uuid
    ),
    ordered AS (
      SELECT media_id,
             row_number() OVER (ORDER BY position, created_at, media_id)::int - 1 AS n
      FROM list_items
      WHERE list_id = ${listId}::uuid AND EXISTS (SELECT 1 FROM mine)
    ),
    target AS (SELECT n FROM ordered WHERE media_id = ${mediaId}::uuid),
    renumbered AS (
      SELECT o.media_id,
             CASE WHEN t.n + ${step}::int < 0
                    OR t.n + ${step}::int >= (SELECT count(*) FROM ordered) THEN o.n
                  WHEN o.n = t.n THEN t.n + ${step}::int
                  WHEN o.n = t.n + ${step}::int THEN t.n
                  ELSE o.n END AS next
      FROM ordered o, target t
    ),
    changed AS (
      UPDATE list_items i SET position = r.next, updated_at = now()
      FROM renumbered r
      WHERE i.list_id = ${listId}::uuid AND i.media_id = r.media_id
        AND i.position IS DISTINCT FROM r.next
      RETURNING i.media_id
    ),
    touched AS (
      UPDATE lists SET updated_at = now()
      WHERE id IN (SELECT id FROM mine) AND EXISTS (SELECT 1 FROM changed)
      RETURNING id
    )
    SELECT count(*)::int AS found FROM target
  `);
  return Number(rows[0]?.found) === 1;
}
