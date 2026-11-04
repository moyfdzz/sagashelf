import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * What the inbox of notifications reads and writes (SAG-102, ADR-030). The rows are written by
 * `announceNewEpisodes`; here a person only reads them and marks them. Every function is one
 * statement, and every one that is about a person's rows has the id of the person of the session in
 * its `WHERE`, so knowing the id of a notification is not enough to read or mark somebody else's.
 */

/** How many the page lists. Older ones are still kept (30 days) but not drawn. */
export const pageSize = 50;

/** The count in the header stops here ("99+"), so counting is never a scan of a long table. */
export const unreadCap = 99;

export type NotificationView = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
};

const asDate = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));

/**
 * How many unread notifications the person with this Clerk id has, up to `unreadCap` plus one (so
 * the header can say "99+"). The Clerk id is the one of the verified session. A person with no
 * account row has none.
 */
export async function countUnreadByClerkId(
  db: SqlExecutor,
  clerkId: string,
): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS unread
    FROM (
      SELECT 1
      FROM notifications n
      JOIN users u ON u.id = n.user_id
      WHERE u.clerk_id = ${clerkId} AND u.deleted_at IS NULL AND n.read_at IS NULL
      LIMIT ${unreadCap + 1}::int
    ) capped
  `);
  return Number(rows[0]?.unread ?? 0);
}

/** The newest notifications of one person, unread or not. */
export async function listNotifications(
  db: SqlExecutor,
  userId: string,
): Promise<NotificationView[]> {
  const { rows } = await db.execute(sql`
    SELECT id, type, payload, created_at, read_at
    FROM notifications
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC, id DESC
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
    FROM notifications
    WHERE user_id = ${userId}::uuid AND read_at IS NULL
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
