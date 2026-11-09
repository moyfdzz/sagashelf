import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { blockedBetween, levelAllowed } from "./person-visibility";
import { canFollow } from "../social/can-view";

/**
 * Following a person (SAG-21, ADR-031). Like the rest of the social graph, every function is ONE
 * statement, so it is atomic on the HTTP client of the Worker, and takes the id of the person of
 * the verified session (`viewerId`), never an id from a request. The person a request names is
 * named by username, and following a profile that is missing, erased, private, friends-only or
 * blocked all answer `unavailable`, so the answer says nothing about who exists.
 */

/** New follows one person may make in an hour (anti-spam). A person who is over it gets `too_many`. */
export const followsPerHour = 60;

export type FollowResult = "followed" | "unavailable" | "too_many";

/**
 * Follows a person by username. Allowed only when the person exists, is not erased, is not the
 * viewer, has a **public** profile (a Private one can only be followed through a request, see
 * `follow-requests.ts`), and neither has blocked the other. Following someone already followed is
 * `followed` too, and that is answered before the hourly cap applies (SAG-165): repeating a follow is not a new one. The hourly cap, shared with the requests sent, is read in the same statement.
 */
export async function followUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<FollowResult> {
  const { rows } = await db.execute(sql`
    WITH recent AS (
      SELECT (
        (SELECT count(*) FROM follows
          WHERE follower_id = ${viewerId}::uuid AND created_at > now() - interval '1 hour')
        + (SELECT count(*) FROM follow_requests
          WHERE requester_id = ${viewerId}::uuid AND created_at > now() - interval '1 hour')
      )::int AS n
    ),
    target AS (
      SELECT u.id
      FROM users u
      WHERE u.username = ${username}
        AND u.deleted_at IS NULL
        AND ${levelAllowed(sql`u.privacy`, canFollow)}
        AND u.id <> ${viewerId}::uuid
        AND NOT ${blockedBetween(sql`${viewerId}::uuid`, sql`u.id`)}
        AND (
          (SELECT n FROM recent) < ${followsPerHour}::int
          OR EXISTS (
            SELECT 1 FROM follows f
            WHERE f.follower_id = ${viewerId}::uuid AND f.followee_id = u.id
          )
        )
    ),
    added AS (
      INSERT INTO follows (follower_id, followee_id)
      SELECT ${viewerId}::uuid, id FROM target
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    -- A request sent while the profile was Private has no use once it is Public and followed.
    unrequested AS (
      DELETE FROM follow_requests
      WHERE requester_id = ${viewerId}::uuid AND target_id IN (SELECT id FROM target)
      RETURNING 1
    )
    SELECT (SELECT n FROM recent) AS recent, EXISTS (SELECT 1 FROM target) AS allowed
  `);
  const row = rows[0];
  if (row?.allowed === true) return "followed";
  return Number(row?.recent ?? 0) >= followsPerHour
    ? "too_many"
    : "unavailable";
}

/** Stops following a person. Always the same answer: it does nothing when there was no follow. */
export async function unfollowUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM follows
    WHERE follower_id = ${viewerId}::uuid
      AND followee_id IN (SELECT id FROM users WHERE username = ${username})
  `);
}
