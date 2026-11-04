import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { toPerson, type Person } from "./person";

/**
 * Blocking and muting a person (SAG-21, ADR-031): the controls a person has over who reaches them.
 * Like the rest of the social graph, every function is ONE statement and takes the id of the person
 * of the verified session (`viewerId`), never an id from a request. Blocking, unblocking, muting
 * and unmuting always answer the same, whoever the name belongs to, so the answer says nothing
 * about who exists.
 */

/**
 * Blocks a person: records the block and removes every follow and every pending follow request
 * between the two, in both directions, in the same statement. Blocking someone who does not exist, or oneself, does nothing.
 */
export async function blockUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    WITH target AS (
      SELECT id FROM users
      WHERE username = ${username} AND deleted_at IS NULL AND id <> ${viewerId}::uuid
    ),
    blocked AS (
      INSERT INTO blocks (blocker_id, blocked_id)
      SELECT ${viewerId}::uuid, id FROM target
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    unfollowed AS (
      DELETE FROM follows
      WHERE (follower_id = ${viewerId}::uuid AND followee_id IN (SELECT id FROM target))
         OR (followee_id = ${viewerId}::uuid AND follower_id IN (SELECT id FROM target))
      RETURNING 1
    ),
    unrequested AS (
      DELETE FROM follow_requests
      WHERE (requester_id = ${viewerId}::uuid AND target_id IN (SELECT id FROM target))
         OR (target_id = ${viewerId}::uuid AND requester_id IN (SELECT id FROM target))
      RETURNING 1
    )
    SELECT 1
  `);
}

/** Removes the block the viewer made. It does not bring the follows back. */
export async function unblockUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM blocks
    WHERE blocker_id = ${viewerId}::uuid
      AND blocked_id IN (SELECT id FROM users WHERE username = ${username})
  `);
}

/** Mutes a person. It is only stored: the other person is not told and nothing is hidden yet. */
export async function muteUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO mutes (muter_id, muted_id)
    SELECT ${viewerId}::uuid, id FROM users
    WHERE username = ${username} AND deleted_at IS NULL AND id <> ${viewerId}::uuid
    ON CONFLICT DO NOTHING
  `);
}

export async function unmuteUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM mutes
    WHERE muter_id = ${viewerId}::uuid
      AND muted_id IN (SELECT id FROM users WHERE username = ${username})
  `);
}

/** Whether the viewer has muted the owner. Only the person who muted can ask: it is their own row. */
export async function isMuted(
  db: SqlExecutor,
  viewerId: string,
  ownerId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM mutes WHERE muter_id = ${viewerId}::uuid AND muted_id = ${ownerId}::uuid
    ) AS muted
  `);
  return rows[0]?.muted === true;
}

/** The people the viewer has blocked, newest first, for the page where a block can be undone. */
export async function listBlocked(
  db: SqlExecutor,
  viewerId: string,
): Promise<Person[]> {
  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url
    FROM blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ${viewerId}::uuid AND u.deleted_at IS NULL
    ORDER BY b.created_at DESC, u.id
    LIMIT 200
  `);
  return rows.map(toPerson);
}

/** The people the viewer has muted, newest first. */
export async function listMuted(
  db: SqlExecutor,
  viewerId: string,
): Promise<Person[]> {
  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url
    FROM mutes m JOIN users u ON u.id = m.muted_id
    WHERE m.muter_id = ${viewerId}::uuid AND u.deleted_at IS NULL
    ORDER BY m.created_at DESC, u.id
    LIMIT 200
  `);
  return rows.map(toPerson);
}
