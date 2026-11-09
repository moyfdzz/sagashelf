import { sql, type SQL } from "drizzle-orm";

import { canSeeCard, levels, type Level } from "../social/can-view";

/**
 * Which people a viewer may be shown (SAG-164, ADR-031). Two rules, each written once as a piece of
 * SQL so the statements that list people, count them, mute them and block them cannot drift apart.
 * Both pieces talk about the row of `users` aliased `u`, and `viewerId` is the person of the
 * verified session (null for a visitor), never an id from a request.
 */

/**
 * The two people have a block between them, in either direction (SAG-178). THE one definition of
 * that check: every statement that reads `blocks` uses it (a test enforces it). `a` and `b` are SQL
 * pieces that give a user id: a bound value with its cast, or a column like `u.id`.
 */
export const blockedBetween = (a: SQL, b: SQL): SQL => sql`
  EXISTS (
    SELECT 1 FROM blocks k
    WHERE (k.blocker_id = ${a} AND k.blocked_id = ${b})
       OR (k.blocker_id = ${b} AND k.blocked_id = ${a})
  )`;

/** The viewer and `u` have a block between them, in either direction. */
const blockedEitherWay = (viewerId: string | null): SQL =>
  blockedBetween(sql`${viewerId}::uuid`, sql`u.id`);

/**
 * `column` holds one of the levels that `allows` accepts, as an `IN` list. The levels are the ones
 * of `can-view.ts`, so a statement never writes `'public'` or `'friends'` for a rule (SAG-178).
 */
export const levelAllowed = (
  column: SQL,
  allows: (level: Level) => boolean,
): SQL =>
  sql`${column}::text IN (${sql.join(
    levels.filter(allows).map((level) => sql`${level}`),
    sql`, `,
  )})`;

/**
 * `u` may appear on the list of people of `ownerId`. A person with a public profile is listed to
 * anybody; one with a friends-only profile only to their friends and to themselves; one with a
 * private profile only to themselves. The owner of the list sees all of it. Erased accounts and
 * anybody blocked either way with the viewer are left out.
 */
export const listedToViewer = (
  viewerId: string | null,
  ownerId: string,
): SQL => sql`
  u.deleted_at IS NULL
  AND (
    u.privacy = 'public'
    OR u.id = ${viewerId}::uuid
    OR ${ownerId}::uuid = ${viewerId}::uuid
    OR (
      u.privacy = 'friends'
      AND EXISTS (SELECT 1 FROM follows a WHERE a.follower_id = ${viewerId}::uuid AND a.followee_id = u.id)
      AND EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.followee_id = ${viewerId}::uuid)
    )
  )
  AND NOT ${blockedEitherWay(viewerId)}`;

/**
 * The viewer may act on `u` (block or mute) and may be shown them on their own lists of blocked and
 * muted people: `u` is not the viewer, not erased, there is no block between them in either
 * direction, and the viewer may see their card (`canSeeCard` for a stranger: Total privacy is never
 * found) **or** there is already a follow or a follow request between them in either direction (a
 * friend who later chose Total privacy can still be muted).
 */
export const reachableByViewer = (viewerId: string): SQL => {
  return sql`
  u.deleted_at IS NULL
  AND u.id <> ${viewerId}::uuid
  AND NOT ${blockedEitherWay(viewerId)}
  AND (
    ${levelAllowed(sql`u.privacy`, (level) => canSeeCard("stranger", level))}
    OR EXISTS (
      SELECT 1 FROM follows f
      WHERE (f.follower_id = ${viewerId}::uuid AND f.followee_id = u.id)
         OR (f.follower_id = u.id AND f.followee_id = ${viewerId}::uuid)
    )
    OR EXISTS (
      SELECT 1 FROM follow_requests r
      WHERE (r.requester_id = ${viewerId}::uuid AND r.target_id = u.id)
         OR (r.requester_id = u.id AND r.target_id = ${viewerId}::uuid)
    )
  )`;
};

/**
 * A follow request still counts (SAG-167). `privacyColumn` is the `privacy` of the person who asked.
 * A request from somebody whose profile is now Total privacy, or who was banned (a ban moves the
 * profile to Total privacy and remembers the old level), is not listed, not counted and cannot be
 * accepted: the receiver must not learn that the person exists. Nothing is deleted, so when a ban is
 * lifted the level comes back and so does the request. A suspended profile keeps its level and so
 * its requests. The levels come from `canSeeCard`, as in `reachableByViewer`.
 */
export const requesterCardShown = (privacyColumn: SQL): SQL =>
  levelAllowed(privacyColumn, (level) => canSeeCard("stranger", level));
