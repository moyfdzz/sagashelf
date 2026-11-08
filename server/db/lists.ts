import { sql } from "drizzle-orm";

import {
  maxLists,
  type ListFields,
  type ListVisibility,
} from "../lists/schema";
import type { SqlExecutor } from "./clerk-sync";
import { asDate } from "./dates";

/**
 * The lists of a person (SAG-113, ADR-045). Every function is one statement, and every one has the
 * id of the person of the session in its `WHERE`: a list that is not theirs is the same as a list
 * that is not there.
 */

export type OwnList = {
  id: string;
  title: string;
  description: string | null;
  visibility: ListVisibility;
  /** How many titles it holds. */
  items: number;
  updatedAt: Date;
};

// Anything the column could hold that is not one of the two wider levels is the narrowest.
const asVisibility = (value: unknown): ListVisibility =>
  value === "public" || value === "friends" ? value : "private";

const toList = (row: Record<string, unknown>): OwnList => ({
  id: String(row.id),
  title: String(row.title),
  description: row.description ? String(row.description) : null,
  visibility: asVisibility(row.visibility),
  items: Number(row.items),
  updatedAt: asDate(row.updated_at),
});

/**
 * The lists of a person, the one changed last first. There is no `LIMIT`: a person has about
 * `maxLists` at most (see `createList`), and a list that went over the limit must not be hidden.
 */
export async function listOwnLists(
  db: SqlExecutor,
  ownerId: string,
): Promise<OwnList[]> {
  const { rows } = await db.execute(sql`
    SELECT l.id, l.title, l.description, l.visibility, l.updated_at,
           (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS items
    FROM lists l
    WHERE l.owner_id = ${ownerId}::uuid
    ORDER BY l.updated_at DESC, l.id DESC
  `);
  return rows.map(toList);
}

/** How many lists the person has, for the page that makes one to know that the limit is reached. */
export async function countOwnLists(
  db: SqlExecutor,
  ownerId: string,
): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS made FROM lists WHERE owner_id = ${ownerId}::uuid
  `);
  return Number(rows[0]?.made ?? 0);
}

/** One list of the person, or null when there is none with that id that is theirs. */
export async function getOwnList(
  db: SqlExecutor,
  ownerId: string,
  id: string,
): Promise<OwnList | null> {
  const { rows } = await db.execute(sql`
    SELECT l.id, l.title, l.description, l.visibility, l.updated_at,
           (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS items
    FROM lists l
    WHERE l.id = ${id}::uuid AND l.owner_id = ${ownerId}::uuid
  `);
  const row = rows[0];
  return row ? toList(row) : null;
}

export type CreateListResult =
  { outcome: "created"; id: string } | { outcome: "limit" | "duplicate" };

/**
 * Creates a list unless the person is at the limit or already has one with that title. The count,
 * the check and the insert are one statement. The limit is **soft**: two forms sent at the very same
 * moment each count the lists before the other's insert and can pass it by one or two. The rate limit
 * of the writes makes that rare, and an extra list costs nothing, so it is not locked (ADR-045).
 * The title is different: the unique constraint holds it, and `ON CONFLICT DO NOTHING` (with no
 * target on purpose, ADR-043) makes a title that is already taken insert nothing, which is answered
 * as a duplicate. That is the only check, so a form that loses a race for the same title is
 * answered the same way as one that arrives later.
 */
export async function createList(
  db: SqlExecutor,
  ownerId: string,
  fields: ListFields,
): Promise<CreateListResult> {
  const { title, description, visibility } = fields;
  const { rows } = await db.execute(sql`
    WITH mine AS (
      SELECT count(*)::int AS made FROM lists WHERE owner_id = ${ownerId}::uuid
    ),
    inserted AS (
      INSERT INTO lists (owner_id, title, description, visibility)
      SELECT ${ownerId}::uuid, ${title}, ${description}::text, ${visibility}::privacy_level
      FROM mine
      WHERE made < ${maxLists}::int
      ON CONFLICT DO NOTHING
      RETURNING id
    )
    SELECT (SELECT id FROM inserted) AS id, (SELECT made FROM mine) AS made
  `);
  const row = rows[0];
  if (row?.id) return { outcome: "created", id: String(row.id) };
  return { outcome: Number(row?.made) >= maxLists ? "limit" : "duplicate" };
}

export type SaveListResult = "saved" | "duplicate" | "not_found";

/**
 * Changes the title, the description and the visibility of a list of the person. A title that
 * another list of theirs already has is refused in the statement, not left to the constraint.
 */
export async function updateList(
  db: SqlExecutor,
  ownerId: string,
  id: string,
  fields: ListFields,
): Promise<SaveListResult> {
  const { title, description, visibility } = fields;
  const { rows } = await db.execute(sql`
    WITH mine AS (
      SELECT id FROM lists WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
    ),
    clash AS (
      SELECT 1 FROM lists
      WHERE owner_id = ${ownerId}::uuid AND title = ${title} AND id <> ${id}::uuid
    ),
    changed AS (
      UPDATE lists SET
        title = ${title},
        description = ${description}::text,
        visibility = ${visibility}::privacy_level,
        updated_at = now()
      WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
        AND NOT EXISTS (SELECT 1 FROM clash)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM mine)::int AS found,
           (SELECT count(*) FROM changed)::int AS changed
  `);
  const row = rows[0];
  if (Number(row?.found) !== 1) return "not_found";
  return Number(row?.changed) === 1 ? "saved" : "duplicate";
}

/** Deletes a list of the person with its titles (the rows of `list_items` go with it). */
export async function deleteList(
  db: SqlExecutor,
  ownerId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH removed AS (
      DELETE FROM lists WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid RETURNING id
    )
    SELECT count(*)::int AS removed FROM removed
  `);
  return Number(rows[0]?.removed) === 1;
}
