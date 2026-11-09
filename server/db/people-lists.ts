import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { toPerson, type Person } from "./person";
import { listedToViewer } from "./person-visibility";
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

/** What `findViewableProfile` returned for this viewer and owner: a profile the viewer may see. */
type ViewableProfile = NonNullable<
  Awaited<ReturnType<typeof findViewableProfile>>
>;

/**
 * `FROM ... WHERE ...` of the people on one list of an owner, as the viewer may see them. The pages
 * and the totals both build on it, so the head of a profile can never say more than the page lists.
 * `listed.id` is the person who is on the list; `edge` is the follow that puts them there.
 */
function listedPeople(
  kind: Kind,
  viewerId: string | null,
  ownerId: string,
): SQL {
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
  return sql`
    FROM (${edge}) listed
    JOIN users u ON u.id = listed.id
    WHERE ${listedToViewer(viewerId, ownerId)}`;
}

/**
 * One page of the people around a profile. It is `null` unless the viewer may see the profile
 * (`findViewableProfile`). Who is listed also follows their own privacy: a person with a public
 * profile is listed to anybody; one with a friends-only profile only to their friends and to
 * themselves; one with a private profile only to themselves. The owner of the list sees all of it
 * (they know who follows them and whom they follow). Erased accounts, and anybody blocked either
 * way with the viewer, are left out. The newest first; the page is capped by `maxPage`.
 *
 * A route that already ran `findViewableProfile` for this viewer and username passes the result as
 * `viewable`, so the profile is not read twice (SAG-165). Without it the function looks it up.
 */
async function listPeople(
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  kind: Kind,
  page: number,
  viewable?: ViewableProfile,
): Promise<PeoplePage | null> {
  // The handed profile is trusted only when it is the one asked for; any other is looked up again.
  const found =
    viewable?.owner.username.toLowerCase() === username.toLowerCase()
      ? viewable
      : await findViewableProfile(db, viewerId, username);
  if (!found) return null;
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), maxPage);
  const offset = (safePage - 1) * pageSize;
  const ownerId = found.owner.id;

  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url
    ${listedPeople(kind, viewerId, ownerId)}
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
  viewable?: ViewableProfile,
) => listPeople(db, viewerId, username, "followers", page, viewable);

export const listFollowing = (
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  page = 1,
  viewable?: ViewableProfile,
) => listPeople(db, viewerId, username, "following", page, viewable);

export const listFriends = (
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
  page = 1,
  viewable?: ViewableProfile,
) => listPeople(db, viewerId, username, "friends", page, viewable);

export type SocialCounts = {
  followers: number;
  following: number;
  friends: number;
};

/**
 * The totals around a person, for the head of a profile, counted with the same filter as the pages
 * (`listedPeople`): they equal the length of the full list the viewer can open, so the head never
 * says more than the page lists. They are only numbers: ask for them after `findViewableProfile`,
 * like everything else about a profile.
 */
export async function getSocialCounts(
  db: SqlExecutor,
  viewerId: string | null,
  ownerId: string,
): Promise<SocialCounts> {
  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(*) ${listedPeople("followers", viewerId, ownerId)})::int AS followers,
      (SELECT count(*) ${listedPeople("following", viewerId, ownerId)})::int AS following,
      (SELECT count(*) ${listedPeople("friends", viewerId, ownerId)})::int AS friends
  `);
  const row = rows[0];
  return {
    followers: Number(row?.followers ?? 0),
    following: Number(row?.following ?? 0),
    friends: Number(row?.friends ?? 0),
  };
}
