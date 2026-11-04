import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { text } from "./person";
import {
  canSeeCard,
  canView,
  relationshipOf,
  type Level,
  type Relationship,
} from "../social/can-view";

/**
 * Who may see a profile (SAG-21, ADR-031): how the viewer stands to the owner, and the profile of a
 * username as the viewer may see it. Like the rest of the social graph, every function takes the id
 * of the person of the verified session (`viewerId`), never an id from a request, and the person a
 * request names is named by username.
 *
 * Nothing here says whether a username exists to someone who may not know: a missing username, an
 * erased account, a block in either direction and a profile that may not be seen all answer null.
 */

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

/**
 * The head of the profile of a username and how the viewer stands to it, whatever the viewer may
 * see: null only for a username that does not exist or an erased account. It is the one place that
 * reads the row and builds the head; `findViewableProfile` and `findProfile` decide what to show.
 */
async function loadProfile(
  db: SqlExecutor,
  viewerId: string | null,
  username: string,
): Promise<{ head: ProfileHead; relationship: Relationship } | null> {
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
  return { head, relationship: await getRelationship(db, viewerId, head.id) };
}

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
  const found = await loadProfile(db, viewerId, username);
  if (!found) return null;
  const { head, relationship } = found;
  return canView(relationship, head.privacy)
    ? { owner: head, relationship }
    : null;
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
  const found = await loadProfile(db, viewerId, username);
  if (!found) return null;
  const { head, relationship } = found;
  if (canView(relationship, head.privacy)) {
    return { owner: head, relationship, view: "full" };
  }
  if (canSeeCard(relationship, head.privacy)) {
    return { owner: { ...head, bio: null }, relationship, view: "card" };
  }
  return null;
}
