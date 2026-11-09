import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { toPerson, type Person } from "./person";
import { reachableByViewer } from "./person-visibility";

/**
 * Blocking and muting a person (SAG-21, ADR-031): the controls a person has over who reaches them.
 * Like the rest of the social graph, every function is ONE statement and takes the id of the person
 * of the verified session (`viewerId`), never an id from a request. Blocking, unblocking, muting
 * and unmuting always answer the same, whoever the name belongs to, so the answer says nothing
 * about who exists.
 */

/**
 * Blocks a person: records the block and removes every follow and every pending follow request
 * between the two, in both directions, in the same statement. Blocking oneself, someone who does not
 * exist or someone the viewer may not reach (`reachableByViewer`: Total privacy with no tie between
 * them, or a block either way) stores nothing, and the answer is the same in every case.
 */
export async function blockUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    WITH target AS (
      SELECT u.id FROM users u
      WHERE u.username = ${username} AND ${reachableByViewer(viewerId)}
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

/**
 * Mutes a person. It is only stored: the other person is not told and nothing is hidden yet. Like a
 * block, it stores nothing for somebody the viewer may not reach.
 */
export async function muteUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO mutes (muter_id, muted_id)
    SELECT ${viewerId}::uuid, u.id FROM users u
    WHERE u.username = ${username} AND ${reachableByViewer(viewerId)}
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

/**
 * The people the viewer has blocked, newest first, for the page where a block can be undone. These
 * are the viewer's own rows, so a person who later became hidden is still listed: otherwise the
 * block could never be undone.
 */
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

/**
 * The people the viewer has muted, newest first. Somebody the viewer may no longer reach (they
 * chose Total privacy with no tie left, or blocked the viewer) is not shown.
 */
export async function listMuted(
  db: SqlExecutor,
  viewerId: string,
): Promise<Person[]> {
  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url
    FROM mutes m JOIN users u ON u.id = m.muted_id
    WHERE m.muter_id = ${viewerId}::uuid AND ${reachableByViewer(viewerId)}
    ORDER BY m.created_at DESC, u.id
    LIMIT 200
  `);
  return rows.map(toPerson);
}
