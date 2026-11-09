import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { followsPerHour } from "./follows";
import {
  blockedBetween,
  levelAllowed,
  requesterCardShown,
} from "./person-visibility";
import { canFollow, canRequest } from "../social/can-view";
import { type Person } from "./person";
import { asDate } from "./dates";

/**
 * Follow requests (SAG-108, ADR-032): the way to ask for a profile that is Private (code level
 * `friends`). Like the rest of the social graph, every function is ONE statement, takes the id of
 * the person of the verified session and names the other person by username.
 *
 * Nothing here says whether a username exists to someone who may not know: asking for a profile that
 * is missing, erased, public, hidden (`private`), blocked or one's own all answer `unavailable`. And
 * declining tells nobody: a declined request stays as a row with `declined_at` set, so it still looks
 * "sent" to the requester and the owner never sees it again.
 */

/** Requests one person may have sent and not seen answered (declined ones count: they look sent). */
export const sentRequestsMax = 100;

/** The most pending requests the page of notifications lists. */
export const pendingListMax = 50;

export type RequestResult = "requested" | "unavailable" | "too_many";

/**
 * Sends a request to follow a person with a Private profile. Allowed when the person exists, is not
 * erased, is not the viewer, has level `friends`, is not already followed, and neither has blocked
 * the other. It shares the hourly cap of follows (`followsPerHour`), and a person may have at most
 * `sentRequestsMax` requests sent. Asking again for a request already pending is `requested` and
 * changes nothing, and so does asking again for a declined one: the requester must cancel it first
 * (ADR-034), which is what lets them ask again at once.
 */
export async function requestFollow(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<RequestResult> {
  const { rows } = await db.execute(sql`
    WITH recent AS (
      SELECT (
        (SELECT count(*) FROM follows
          WHERE follower_id = ${viewerId}::uuid AND created_at > now() - interval '1 hour')
        + (SELECT count(*) FROM follow_requests
          WHERE requester_id = ${viewerId}::uuid AND created_at > now() - interval '1 hour')
      )::int AS n
    ),
    sent AS (
      SELECT count(*)::int AS n FROM follow_requests WHERE requester_id = ${viewerId}::uuid
    ),
    target AS (
      SELECT u.id
      FROM users u
      WHERE u.username = ${username}
        AND u.deleted_at IS NULL
        AND ${levelAllowed(sql`u.privacy`, canRequest)}
        AND u.id <> ${viewerId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = ${viewerId}::uuid AND f.followee_id = u.id
        )
        AND NOT ${blockedBetween(sql`${viewerId}::uuid`, sql`u.id`)}
        AND (
          (
            (SELECT n FROM recent) < ${followsPerHour}::int
            AND (SELECT n FROM sent) < ${sentRequestsMax}::int
          )
          -- A request already out is not a new one: neither cap applies to it (SAG-165).
          OR EXISTS (
            SELECT 1 FROM follow_requests r
            WHERE r.requester_id = ${viewerId}::uuid AND r.target_id = u.id
          )
        )
    ),
    added AS (
      INSERT INTO follow_requests (requester_id, target_id)
      SELECT ${viewerId}::uuid, id FROM target
      ON CONFLICT (requester_id, target_id) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT n FROM recent) AS recent, (SELECT n FROM sent) AS sent,
           EXISTS (SELECT 1 FROM target) AS allowed
  `);
  const row = rows[0];
  if (row?.allowed === true) return "requested";
  return Number(row?.recent ?? 0) >= followsPerHour ||
    Number(row?.sent ?? 0) >= sentRequestsMax
    ? "too_many"
    : "unavailable";
}

/**
 * Takes back a request the viewer sent, also one the owner declined (ADR-034): the owner is told
 * nothing either way, and the viewer may ask again at once. It always answers the same: it does
 * nothing when there was no request.
 */
export async function cancelRequest(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM follow_requests
    WHERE requester_id = ${viewerId}::uuid
      AND target_id IN (SELECT id FROM users WHERE username = ${username})
  `);
}

/** Whether the viewer has sent a request to the owner that the page should still show as sent. */
export async function hasRequested(
  db: SqlExecutor,
  viewerId: string,
  ownerId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM follow_requests
      WHERE requester_id = ${viewerId}::uuid AND target_id = ${ownerId}::uuid
    ) AS requested
  `);
  return rows[0]?.requested === true;
}

export type PendingRequest = Person & {
  /**
   * Whether there is something to follow back: a person the owner already follows needs nothing
   * more (SAG-126). A requester with Total privacy is never listed (SAG-167), so no listed person
   * is a profile that cannot be asked for.
   */
  canFollowBack: boolean;
  createdAt: Date;
};

/**
 * The requests waiting for the owner, newest first. A request from an erased account, from somebody
 * the owner blocked and from somebody who blocked the owner is left out (and a block also removes
 * it, so this is a second guard). Declined ones are never listed, and neither are requests from a
 * person who is now Total privacy or banned (SAG-167).
 */
export async function listPendingRequests(
  db: SqlExecutor,
  ownerId: string,
): Promise<PendingRequest[]> {
  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url, u.privacy, r.created_at,
           EXISTS (
             SELECT 1 FROM follows f
             WHERE f.follower_id = ${ownerId}::uuid AND f.followee_id = u.id
           ) AS already_followed
    FROM follow_requests r
    JOIN users u ON u.id = r.requester_id
    WHERE r.target_id = ${ownerId}::uuid
      AND r.declined_at IS NULL
      AND u.deleted_at IS NULL
      AND ${requesterCardShown(sql`u.privacy`)}
      AND NOT ${blockedBetween(sql`${ownerId}::uuid`, sql`u.id`)}
    ORDER BY r.created_at DESC, u.id
    LIMIT ${pendingListMax}::int
  `);
  return rows.map((row) => ({
    username: String(row.username),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : null,
    canFollowBack: row.already_followed !== true,
    createdAt: asDate(row.created_at),
  }));
}

/**
 * Accepts the request of a username: the requester follows the owner. With `followBack`, the owner
 * also follows the requester when that profile is Public, or sends them a request when it is
 * Private, so nobody gets into a Private profile without accepting; a hidden (`private`) profile
 * is not followed back. Returns false when there is no such pending request. The follow back is not
 * counted in the hourly cap: it only answers a person who asked.
 */
export async function acceptRequest(
  db: SqlExecutor,
  ownerId: string,
  username: string,
  followBack: boolean,
): Promise<boolean> {
  // A word of SQL and not a parameter, so it does not depend on how a driver sends a boolean.
  const back = followBack ? sql`true` : sql`false`;
  const { rows } = await db.execute(sql`
    WITH req AS (
      SELECT r.requester_id AS id, u.privacy
      FROM follow_requests r
      JOIN users u ON u.id = r.requester_id
      WHERE r.target_id = ${ownerId}::uuid
        AND r.declined_at IS NULL
        AND u.username = ${username}
        AND u.deleted_at IS NULL
        AND ${requesterCardShown(sql`u.privacy`)}
        AND NOT ${blockedBetween(sql`${ownerId}::uuid`, sql`u.id`)}
    ),
    accepted AS (
      INSERT INTO follows (follower_id, followee_id)
      SELECT id, ${ownerId}::uuid FROM req
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    removed AS (
      DELETE FROM follow_requests
      WHERE target_id = ${ownerId}::uuid AND requester_id IN (SELECT id FROM req)
      RETURNING 1
    ),
    followed_back AS (
      INSERT INTO follows (follower_id, followee_id)
      SELECT ${ownerId}::uuid, id FROM req
      WHERE ${back} AND ${levelAllowed(sql`privacy`, canFollow)}
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    asked_back AS (
      INSERT INTO follow_requests (requester_id, target_id)
      SELECT ${ownerId}::uuid, id FROM req
      WHERE ${back}
        AND ${levelAllowed(sql`privacy`, canRequest)}
        AND NOT EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = ${ownerId}::uuid AND f.followee_id = req.id
        )
      ON CONFLICT (requester_id, target_id) DO NOTHING
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM req) AS found
  `);
  return rows[0]?.found === true;
}

/**
 * Declines the request of a username. Nobody is told: the row stays with `declined_at` set, so the
 * requester keeps seeing "sent" until they cancel it (ADR-034). Declining what is not there, or what
 * is already declined, does nothing.
 */
export async function declineRequest(
  db: SqlExecutor,
  ownerId: string,
  username: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH declined AS (
      UPDATE follow_requests SET declined_at = now()
      WHERE target_id = ${ownerId}::uuid
        AND declined_at IS NULL
        AND requester_id IN (SELECT id FROM users WHERE username = ${username})
      RETURNING 1
    )
    SELECT count(*)::int AS declined FROM declined
  `);
  return Number(rows[0]?.declined ?? 0) > 0;
}
