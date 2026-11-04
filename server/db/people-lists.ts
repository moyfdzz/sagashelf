import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { toPerson, type Person } from "./person";
import { findViewableProfile } from "./profile-lookup";

/**
 * The people around a profile (SAG-107, ADR-031): the pages of followers, following and friends,
 * and the totals for the head of a profile. Like the rest of the social graph, every function
 * takes the id of the person of the verified session (`viewerId`), never an id from a request.
 */

/** People in one page of a list. */
export const pageSize = 50;

/** The last page of a list that can be asked for, so nobody pages through all the users. */
export const maxPage = 100;

export type PeoplePage = { people: Person[]; hasMore: boolean };

type Kind = "followers" | "following" | "friends";

/**
 * One page of the people around a profile. It is `null` unless the viewer may see the profile
 * (`findViewableProfile`). Who is listed also follows their own privacy: a person with a public
 * profile is listed to anybody; one with a friends-only profile only to their friends and to
 * themselves; one with a private profile only to themselves. The owner of the list sees all of it
 * (they know who follows them and whom they follow). Erased accounts, and anybody blocked either
 * way with the viewer, are left out. The newest first; the page is capped by `maxPage`.
 */
async function listPeople(
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  kind: Kind,
  page: number,
): Promise<PeoplePage | null> {
  const found = await findViewableProfile(db, viewerId, username);
  if (!found) return null;
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), maxPage);
  const offset = (safePage - 1) * pageSize;
  const ownerId = found.owner.id;

  // `listed.id` is the person who is on the list; `edge` is the follow that puts them there.
  const edge =
    kind === "followers"
      ? sql`SELECT f.follower_id AS id, f.created_at FROM follows f WHERE f.followee_id = ${ownerId}::uuid`
      : kind === "following"
        ? sql`SELECT f.followee_id AS id, f.created_at FROM follows f WHERE f.follower_id = ${ownerId}::uuid`
        : sql`
            SELECT f.followee_id AS id, f.created_at
            FROM follows f
            WHERE f.follower_id = ${ownerId}::uuid
              AND EXISTS (
                SELECT 1 FROM follows back
                WHERE back.follower_id = f.followee_id AND back.followee_id = ${ownerId}::uuid
              )`;

  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url
    FROM (${edge}) listed
    JOIN users u ON u.id = listed.id
    WHERE u.deleted_at IS NULL
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
      AND NOT EXISTS (
        SELECT 1 FROM blocks k
        WHERE (k.blocker_id = ${viewerId}::uuid AND k.blocked_id = u.id)
           OR (k.blocker_id = u.id AND k.blocked_id = ${viewerId}::uuid)
      )
    ORDER BY listed.created_at DESC, u.id
    LIMIT ${pageSize + 1}::int OFFSET ${offset}::int
  `);
  return {
    people: rows.slice(0, pageSize).map(toPerson),
    hasMore: rows.length > pageSize,
  };
}

export const listFollowers = (
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  page = 1,
) => listPeople(db, viewerId, username, "followers", page);

export const listFollowing = (
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  page = 1,
) => listPeople(db, viewerId, username, "following", page);

export const listFriends = (
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  page = 1,
) => listPeople(db, viewerId, username, "friends", page);

export type SocialCounts = {
  followers: number;
  following: number;
  friends: number;
};

/**
 * The totals around a person, for the head of a profile. Erased accounts are not counted. They are
 * only numbers: ask for them after `findViewableProfile`, like everything else about a profile.
 */
export async function getSocialCounts(
  db: SqlExecutor,
  ownerId: string,
): Promise<SocialCounts> {
  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM follows f JOIN users u ON u.id = f.follower_id
        WHERE f.followee_id = ${ownerId}::uuid AND u.deleted_at IS NULL)::int AS followers,
      (SELECT count(*) FROM follows f JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = ${ownerId}::uuid AND u.deleted_at IS NULL)::int AS following,
      (SELECT count(*) FROM follows f JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = ${ownerId}::uuid AND u.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM follows back
            WHERE back.follower_id = f.followee_id AND back.followee_id = ${ownerId}::uuid
          ))::int AS friends
  `);
  const row = rows[0];
  return {
    followers: Number(row?.followers ?? 0),
    following: Number(row?.following ?? 0),
    friends: Number(row?.friends ?? 0),
  };
}
