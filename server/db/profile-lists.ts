import { sql } from "drizzle-orm";

import type { Locale } from "../providers/types";
import type { ListVisibility } from "../lists/schema";
import {
  canView,
  levels,
  type Level,
  type Relationship,
} from "../social/can-view";
import type { SqlExecutor } from "./clerk-sync";
import { asDate } from "./dates";
import { localizedTitleSql } from "./titles";

/**
 * The lists of a person as somebody else may see them (SAG-113, ADR-045). The rule is the one of
 * the library on a profile (ADR-031): a list is seen by whoever `canView` allows for the
 * **strictest** of the level of the list and the level of the profile, and the filter is in the
 * query, so a list the viewer may not see never leaves the database. A title is read only through
 * its list with the same filter, and the note of a title is not read at all: it is private to the
 * owner. Ask for any of this only after `findViewableProfile` found the profile.
 */

/** The levels of list that the viewer may see on this profile: the ones `canView` allows. */
export function visibleListLevels(
  relationship: Relationship,
  profileLevel: Level,
): Level[] {
  return levels.filter((level) => canView(relationship, level, profileLevel));
}

const inLevels = (allowed: readonly Level[]) =>
  sql.join(
    allowed.map((level) => sql`${level}`),
    sql`, `,
  );

export type ViewableList = {
  id: string;
  title: string;
  description: string | null;
  visibility: ListVisibility;
  /** How many titles it holds. */
  items: number;
  updatedAt: Date;
};

const asVisibility = (value: unknown): ListVisibility =>
  value === "public" || value === "friends" ? value : "private";

const toList = (row: Record<string, unknown>): ViewableList => ({
  id: String(row.id),
  title: String(row.title),
  description: row.description ? String(row.description) : null,
  visibility: asVisibility(row.visibility),
  items: Number(row.items),
  updatedAt: asDate(row.updated_at),
});

/** The lists of the owner that the viewer may see, the one changed last first. */
export async function listViewableLists(
  db: SqlExecutor,
  ownerId: string,
  allowed: readonly Level[],
): Promise<ViewableList[]> {
  if (allowed.length === 0) return [];
  const { rows } = await db.execute(sql`
    SELECT l.id, l.title, l.description, l.visibility, l.updated_at,
           (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS items
    FROM lists l
    WHERE l.owner_id = ${ownerId}::uuid
      AND l.visibility::text IN (${inLevels(allowed)})
    ORDER BY l.updated_at DESC, l.id DESC
  `);
  return rows.map(toList);
}

/** One list of the owner, or null when it is not theirs, is not there or may not be seen. */
export async function getViewableList(
  db: SqlExecutor,
  ownerId: string,
  id: string,
  allowed: readonly Level[],
): Promise<ViewableList | null> {
  if (allowed.length === 0) return null;
  const { rows } = await db.execute(sql`
    SELECT l.id, l.title, l.description, l.visibility, l.updated_at,
           (SELECT count(*)::int FROM list_items i WHERE i.list_id = l.id) AS items
    FROM lists l
    WHERE l.id = ${id}::uuid
      AND l.owner_id = ${ownerId}::uuid
      AND l.visibility::text IN (${inLevels(allowed)})
  `);
  const row = rows[0];
  return row ? toList(row) : null;
}

export type ViewableItem = {
  mediaId: string;
  type: string;
  title: string;
  year: number | null;
};

/** The titles of a list in the order the owner chose, with no note. None for a list not seen. */
export async function listViewableItems(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  allowed: readonly Level[],
  locale: Locale,
): Promise<ViewableItem[]> {
  if (allowed.length === 0) return [];
  const { rows } = await db.execute(sql`
    SELECT i.media_id, m.type, m.year, ${localizedTitleSql("m", locale)} AS title
    FROM list_items i
    JOIN lists l ON l.id = i.list_id
    JOIN media_items m ON m.id = i.media_id
    WHERE i.list_id = ${listId}::uuid
      AND l.owner_id = ${ownerId}::uuid
      AND l.visibility::text IN (${inLevels(allowed)})
    ORDER BY i.position, i.created_at, i.media_id
  `);
  return rows.map((row) => ({
    mediaId: String(row.media_id),
    type: String(row.type),
    title: String(row.title),
    year: row.year == null ? null : Number(row.year),
  }));
}
