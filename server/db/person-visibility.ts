import { sql, type SQL } from "drizzle-orm";

import { canSeeCard, levels } from "../social/can-view";

/**
 * Which people a viewer may be shown (SAG-164, ADR-031). Two rules, each written once as a piece of
 * SQL so the statements that list people, count them, mute them and block them cannot drift apart.
 * Both pieces talk about the row of `users` aliased `u`, and `viewerId` is the person of the
 * verified session (null for a visitor), never an id from a request.
 */

/** The viewer and `u` have a block between them, in either direction. */
const blockedEitherWay = (viewerId: string | null): SQL => sql`
  EXISTS (
    SELECT 1 FROM blocks k
    WHERE (k.blocker_id = ${viewerId}::uuid AND k.blocked_id = u.id)
       OR (k.blocker_id = u.id AND k.blocked_id = ${viewerId}::uuid)
  )`;

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
  const found = levels.filter((level) => canSeeCard("stranger", level));
  return sql`
  u.deleted_at IS NULL
  AND u.id <> ${viewerId}::uuid
  AND NOT ${blockedEitherWay(viewerId)}
  AND (
    u.privacy::text IN (${sql.join(
      found.map((level) => sql`${level}`),
      sql`, `,
    )})
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
