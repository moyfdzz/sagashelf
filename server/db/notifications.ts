import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { asDate } from "./dates";
import { contactCreatedType } from "../account/contact-schema";
import { reportCreatedType } from "./reports";

/**
 * What the inbox of notifications reads and writes (SAG-102, ADR-030). The rows are written by
 * `announceNewEpisodes`; here a person only reads them and marks them. Every function is one
 * statement, and every one that is about a person's rows has the id of the person of the session in
 * its `WHERE`, so knowing the id of a notification is not enough to read or mark somebody else's.
 */

/** How many the page lists. Older ones are still kept (30 days) but not drawn. */
export const pageSize = 50;

/**
 * The count in the header stops here ("99+"), so counting is never a scan of a long table. The read
 * of the header (`findHeaderFacts`) counts up to this plus one.
 */
export const unreadCap = 99;

export type NotificationView = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
};

/**
 * The notifications row `n` may be shown to its owner (SAG-177). The alert of a report holds the
 * username of the person reported, and a contact message alert points to the administration: both
 * are for administrators, and somebody who lost the role is not shown the old ones. THE one place
 * of this rule; the page, the count, the header and the data export read it.
 */
export const readableByOwner = (n: SQL): SQL => sql`(
  ${n}.type NOT IN (${reportCreatedType}, ${contactCreatedType})
  OR EXISTS (SELECT 1 FROM users o WHERE o.id = ${n}.user_id AND o.role = 'admin')
)`;

/** The newest notifications of one person, unread or not. */
export async function listNotifications(
  db: SqlExecutor,
  userId: string,
): Promise<NotificationView[]> {
  const { rows } = await db.execute(sql`
    SELECT n.id, n.type, n.payload, n.created_at, n.read_at
    FROM notifications n
    WHERE n.user_id = ${userId}::uuid AND ${readableByOwner(sql`n`)}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${pageSize}::int
  `);
  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
    createdAt: asDate(row.created_at),
    readAt: row.read_at ? asDate(row.read_at) : null,
  }));
}

/** The number of unread notifications of one person (no cap: the page has its own list). */
export async function countUnread(
  db: SqlExecutor,
  userId: string,
): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS unread
    FROM notifications n
    WHERE n.user_id = ${userId}::uuid AND n.read_at IS NULL AND ${readableByOwner(sql`n`)}
  `);
  return Number(rows[0]?.unread ?? 0);
}

/**
 * Marks one notification as read. Marking one that is already read changes nothing (the first
 * time it was read stays), and it is not an error. Returns false when the person has no such
 * notification, which is also what somebody else's id gets.
 */
export async function markRead(
  db: SqlExecutor,
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH marked AS (
      UPDATE notifications SET read_at = ${now.toISOString()}::timestamptz
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND read_at IS NULL
      RETURNING id
    )
    SELECT EXISTS (
      SELECT 1 FROM notifications WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    ) AS found
  `);
  return rows[0]?.found === true;
}

/** Marks everything unread of one person as read. Returns how many it marked. */
export async function markAllRead(
  db: SqlExecutor,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { rows } = await db.execute(sql`
    WITH marked AS (
      UPDATE notifications SET read_at = ${now.toISOString()}::timestamptz
      WHERE user_id = ${userId}::uuid AND read_at IS NULL
      RETURNING id
    )
    SELECT count(*)::int AS marked FROM marked
  `);
  return Number(rows[0]?.marked ?? 0);
}
