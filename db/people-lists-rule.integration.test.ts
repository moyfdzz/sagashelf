import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  listFollowers,
  listFollowing,
  listFriends,
} from "../server/db/people-lists";
import { blocks, follows } from "../server/db/schema";
import {
  canView,
  levels,
  relationships,
  type Level,
  type Relationship,
} from "../server/social/can-view";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

/**
 * Who appears on a list of followers is the rule `listedToViewer` (SQL), and who may see a profile
 * is `canView` (TypeScript). They are the same rule written twice, so this test ties them
 * (SAG-165): for each relationship of the viewer to a listed person and each level of that
 * person, the person is on the list exactly when `canView` says the viewer may see their profile.
 * The list belongs to a third person with a public profile, so the viewer is never its owner. The
 * three lists (followers, following, friends) share the rule, so each is checked.
 */
const kinds = [
  {
    name: "followers",
    list: listFollowers,
    listedFollows: true,
    ownerFollows: false,
  },
  {
    name: "following",
    list: listFollowing,
    listedFollows: false,
    ownerFollows: true,
  },
  {
    name: "friends",
    list: listFriends,
    listedFollows: true,
    ownerFollows: true,
  },
] as const;

describe("the people lists follow canView (SAG-165)", () => {
  it.each(
    kinds.flatMap((kind) =>
      relationships.flatMap((relationship) =>
        levels.map((level) => [kind.name, relationship, level] as const),
      ),
    ),
  )(
    "on the %s list, lists a %s whose profile is %s exactly when canView allows it",
    async (name: string, relationship: Relationship, level: Level) => {
      const kind = kinds.find((k) => k.name === name) ?? kinds[0];
      const owner = await newUser({
        username: "list_owner",
        privacy: "public",
        emailCanonical: "list_owner@example.test",
      });
      const listed = await newUser({
        username: "listed_person",
        privacy: level,
        emailCanonical: "listed@example.test",
      });
      if (kind.listedFollows) {
        await db
          .insert(follows)
          .values({ followerId: listed.id, followeeId: owner.id });
      }
      if (kind.ownerFollows) {
        await db
          .insert(follows)
          .values({ followerId: owner.id, followeeId: listed.id });
      }

      let viewerId: string | null = null;
      if (relationship === "owner") {
        // The viewer is the listed person themself.
        viewerId = listed.id;
      } else if (relationship !== "signed_out") {
        const viewer = await newUser({
          username: "the_viewer",
          privacy: "public",
          emailCanonical: "viewer@example.test",
        });
        viewerId = viewer.id;
        if (relationship === "friend" || relationship === "follower") {
          await db
            .insert(follows)
            .values({ followerId: viewer.id, followeeId: listed.id });
        }
        if (relationship === "friend") {
          await db
            .insert(follows)
            .values({ followerId: listed.id, followeeId: viewer.id });
        }
        if (relationship === "blocked") {
          await db
            .insert(blocks)
            .values({ blockerId: viewer.id, blockedId: listed.id });
        }
      }

      const page = await kind.list(db, viewerId, "list_owner");
      const shown = page?.people.some((p) => p.username === "listed_person");

      expect(shown).toBe(canView(relationship, level));
    },
  );
});
