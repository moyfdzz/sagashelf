import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import {
  canSeeCard,
  canView,
  relationshipOf,
  type Level,
  type Relationship,
} from "../social/can-view";

/**
 * The social graph: follows, blocks and mutes, and who may see a profile (SAG-21, ADR-031). Every
 * function is ONE statement, so it is atomic on the HTTP client of the Worker, and every one takes
 * the id of the person of the verified session (`viewerId`), never an id from a request. The people
 * a request names are named by username.
 *
 * Nothing here says whether a username exists to someone who may not know: following a profile that
 * is missing, erased, private, friends-only or blocked all answer `unavailable`, and blocking,
 * unblocking, muting and unmuting always answer the same, whoever the name belongs to.
 */

/** New follows one person may make in an hour (anti-spam). A person who is over it gets `too_many`. */
export const followsPerHour = 60;

/** People in one page of a list. */
export const pageSize = 50;

/** The last page of a list that can be asked for, so nobody pages through all the users. */
export const maxPage = 100;

export type FollowResult = "followed" | "unavailable" | "too_many";

/**
 * Follows a person by username. Allowed only when the person exists, is not erased, is not the
 * viewer, has a **public** profile (friends-only and private profiles can only be followed through a
 * request, which is a later ticket), and neither has blocked the other. Following someone already
 * followed is `followed` too. The hourly cap is read in the same statement.
 */
export async function followUser(
  db: SqlExecutor,
  viewerId: string,
  username: string,
): Promise<FollowResult> {
  const { rows } = await db.execute(sql`
    WITH recent AS (
      SELECT count(*)::int AS n
      FROM follows
      WHERE follower_id = ${viewerId}::uuid AND created_at > now() - interval '1 hour'
    ),
    target AS (
      SELECT u.id
      FROM users u
      WHERE u.username = ${username}
        AND u.deleted_at IS NULL
        AND u.privacy = 'public'
        AND u.id <> ${viewerId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId}::uuid)
        )
        AND (SELECT n FROM recent) < ${followsPerHour}::int
    ),
    added AS (
      INSERT INTO follows (follower_id, followee_id)
      SELECT ${viewerId}::uuid, id FROM target
      ON CONFLICT DO NOTHING
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

/**
 * Blocks a person: records the block and removes every follow between the two, in both directions,
 * in the same statement. Blocking someone who does not exist, or oneself, does nothing.
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

/** How the viewer stands to an owner. A visitor is `signed_out` without asking the database. */
export async function getRelationship(
  db: SqlExecutor,
  viewerId: string | null,
  ownerId: string,
): Promise<Relationship> {
  if (viewerId === null) return "signed_out";
  if (viewerId === ownerId) return "owner";
  const { rows } = await db.execute(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = ${ownerId}::uuid)
           OR (b.blocker_id = ${ownerId}::uuid AND b.blocked_id = ${viewerId}::uuid)
      ) AS blocked,
      EXISTS (
        SELECT 1 FROM follows WHERE follower_id = ${viewerId}::uuid AND followee_id = ${ownerId}::uuid
      ) AS viewer_follows,
      EXISTS (
        SELECT 1 FROM follows WHERE follower_id = ${ownerId}::uuid AND followee_id = ${viewerId}::uuid
      ) AS owner_follows
  `);
  const row = rows[0];
  return relationshipOf({
    viewerId,
    ownerId,
    blocked: row?.blocked === true,
    viewerFollowsOwner: row?.viewer_follows === true,
    ownerFollowsViewer: row?.owner_follows === true,
  });
}

/** What a profile page shows of its owner at the top. */
export type ProfileHead = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  privacy: Level;
};

const asLevel = (value: unknown): Level =>
  value === "public" || value === "friends" ? value : "private";

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * The profile of a username as the viewer may see it, or null. Null is the answer for a username
 * that does not exist, an erased account, a block in either direction and a profile the viewer may
 * not see: **the four look the same**, so the answer cannot be used to find out who exists or who
 * has blocked whom. Everything that shows another person's things starts here, and asks `canView`
 * again with the level of each thing.
 */
export async function findViewableProfile(
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
): Promise<{ owner: ProfileHead; relationship: Relationship } | null> {
  const { rows } = await db.execute(sql`
    SELECT id, username, display_name, avatar_url, bio, privacy
    FROM users
    WHERE username = ${username} AND deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  const owner: ProfileHead = {
    id: String(row.id),
    username: String(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    bio: text(row.bio),
    privacy: asLevel(row.privacy),
  };
  const relationship = await getRelationship(db, viewerId, owner.id);
  return canView(relationship, owner.privacy) ? { owner, relationship } : null;
}

/** What a profile page may show of a username: everything, or only the card (a locked profile). */
export type ProfileView = "full" | "card";

/**
 * The profile of a username as the page shows it, or null. `full` when the viewer may see the
 * profile (`canView`), `card` when it is locked (a `friends` profile seen by somebody who is not a
 * friend: only the username, the name and the picture, **never the bio**), and null for a username
 * that does not exist, an erased account, a `private` profile, and a block in either direction: the
 * four look the same, so the answer cannot be used to find out who exists, who is private or who
 * has blocked whom. A person who locked their profile chose to show the card; one who made it
 * private chose to show nothing.
 */
export async function findProfile(
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
): Promise<{
  owner: ProfileHead;
  relationship: Relationship;
  view: ProfileView;
} | null> {
  const { rows } = await db.execute(sql`
    SELECT id, username, display_name, avatar_url, bio, privacy
    FROM users
    WHERE username = ${username} AND deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  const head: ProfileHead = {
    id: String(row.id),
    username: String(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url),
    bio: text(row.bio),
    privacy: asLevel(row.privacy),
  };
  const relationship = await getRelationship(db, viewerId, head.id);
  if (canView(relationship, head.privacy)) {
    return { owner: head, relationship, view: "full" };
  }
  if (canSeeCard(relationship, head.privacy)) {
    return { owner: { ...head, bio: null }, relationship, view: "card" };
  }
  return null;
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

export type Person = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type PeoplePage = { people: Person[]; hasMore: boolean };

const toPerson = (row: Record<string, unknown>): Person => ({
  username: String(row.username),
  displayName: text(row.display_name),
  avatarUrl: text(row.avatar_url),
});

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
