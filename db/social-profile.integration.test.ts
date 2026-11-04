import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  entriesPerSection,
  getProfileSections,
  visibleLevels,
} from "../server/db/profile-library";
import {
  blockUser,
  findProfile,
  isMuted,
  listBlocked,
  listMuted,
  muteUser,
} from "../server/db/social";
import {
  blocks,
  follows,
  libraryEntries,
  mediaItems,
  users,
} from "../server/db/schema";
import {
  levels,
  relationships,
  type Level,
  type Relationship,
} from "../server/social/can-view";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

const person = (username: string, privacy: Level = "public") =>
  newUser({ username, privacy, emailCanonical: `${username}@example.test` });

const follow = (followerId: string, followeeId: string) =>
  db.insert(follows).values({ followerId, followeeId });

/**
 * What the page shows of a profile to each relationship, written out by hand and not asked of
 * `canView` or `canSeeCard`: a test that used them as their own oracle would pass whatever they did.
 */
const expectedView: Record<
  Relationship,
  Record<Level, "full" | "card" | null>
> = {
  owner: { public: "full", friends: "full", private: "full" },
  friend: { public: "full", friends: "full", private: null },
  follower: { public: "full", friends: "card", private: null },
  stranger: { public: "full", friends: "card", private: null },
  signed_out: { public: "full", friends: "card", private: null },
  blocked: { public: null, friends: null, private: null },
};

/** Whether an entry of a level shows in a profile of a level, to each relationship, by hand. */
function entryShows(
  relationship: Relationship,
  profile: Level,
  entry: Level,
): boolean {
  if (relationship === "owner") return true;
  if (relationship === "blocked") return false;
  const bothAre = (...allowed: Level[]) =>
    allowed.includes(profile) && allowed.includes(entry);
  if (relationship === "friend") return bothAre("public", "friends");
  return bothAre("public");
}

async function scene(level: Level) {
  const owner = await person(`owner_${level}`, level);
  const friend = await person(`friend_of_${level}`);
  const fan = await person(`fan_of_${level}`);
  const stranger = await person(`stranger_to_${level}`);
  const blocked = await person(`blocked_by_${level}`);
  await follow(friend.id, owner.id);
  await follow(owner.id, friend.id);
  await follow(fan.id, owner.id);
  await follow(blocked.id, owner.id);
  await follow(owner.id, blocked.id);
  await db
    .insert(blocks)
    .values({ blockerId: owner.id, blockedId: blocked.id });
  const viewerOf: Record<Relationship, string | null> = {
    owner: owner.id,
    friend: friend.id,
    follower: fan.id,
    stranger: stranger.id,
    signed_out: null,
    blocked: blocked.id,
  };
  return { owner, viewerOf };
}

describe("findProfile (SAG-107): every privacy level × every relationship, on the database", () => {
  for (const level of levels) {
    for (const relationship of relationships) {
      const want = expectedView[relationship][level];
      it(`${relationship} gets ${want ?? "nothing"} from a ${level} profile`, async () => {
        const { owner, viewerOf } = await scene(level);

        const found = await findProfile(
          db,
          viewerOf[relationship],
          owner.username,
        );

        expect(found?.view ?? null).toBe(want);
        if (want) {
          expect(found?.owner.id).toBe(owner.id);
          expect(found?.relationship).toBe(relationship);
        }
      });
    }
  }

  it("never gives the bio of a locked profile to somebody who may not see the rest, even though it exists", async () => {
    const owner = await newUser({
      username: "locked_owner",
      privacy: "friends",
      displayName: "Locked Owner",
      avatarUrl: "https://img.clerk.com/locked",
      bio: "a bio that only friends may read",
      emailCanonical: "locked@example.test",
    });
    const stranger = await person("stranger_one");

    const found = await findProfile(db, stranger.id, "locked_owner");

    expect(found?.view).toBe("card");
    expect(found?.owner).toEqual({
      id: owner.id,
      username: "locked_owner",
      displayName: "Locked Owner",
      avatarUrl: "https://img.clerk.com/locked",
      bio: null,
      privacy: "friends",
    });
    expect(JSON.stringify(found)).not.toContain("only friends may read");
    // The friend of the owner does get it.
    const friend = await person("friend_one");
    await follow(friend.id, owner.id);
    await follow(owner.id, friend.id);
    expect((await findProfile(db, friend.id, "locked_owner"))?.owner.bio).toBe(
      "a bio that only friends may read",
    );
  });

  it("answers null in the same way for a missing username, an erased account, a private profile and a block", async () => {
    await person("private_one", "private");
    const gone = await person("gone_one");
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));
    const blocker = await person("blocker_one");
    const viewer = await person("viewer_one");
    await db
      .insert(blocks)
      .values({ blockerId: blocker.id, blockedId: viewer.id });

    const answers = await Promise.all(
      ["private_one", "gone_one", "nobody_here", "blocker_one"].map((name) =>
        findProfile(db, viewer.id, name),
      ),
    );

    expect(answers).toEqual([null, null, null, null]);
  });

  it("finds the profile whatever the case of the address", async () => {
    await person("Mixed_Case");

    expect((await findProfile(db, null, "mixed_case"))?.owner.username).toBe(
      "Mixed_Case",
    );
  });
});

describe("the levels a viewer may see (visibleLevels)", () => {
  it("gives, for each relationship and each profile level, the entry levels that show", () => {
    for (const relationship of relationships) {
      for (const profile of levels) {
        expect(visibleLevels(relationship, profile).sort()).toEqual(
          levels
            .filter((entry) => entryShows(relationship, profile, entry))
            .sort(),
        );
      }
    }
  });
});

describe("getProfileSections (SAG-107): the library on the profile", () => {
  let counter = 0;
  async function entry(
    userId: string,
    overrides: Partial<typeof libraryEntries.$inferInsert> & {
      title?: string;
      titles?: Record<string, string>;
    } = {},
  ) {
    counter += 1;
    const { title, titles, ...values } = overrides;
    const media = await newMedia({
      type: "series",
      title: title ?? `Title ${counter}`,
      titles: titles ?? {},
    });
    await db.insert(libraryEntries).values({
      userId,
      mediaId: media.id,
      status: "in_progress",
      visibility: "public",
      ...values,
    });
    return media;
  }

  for (const profile of levels) {
    for (const relationship of relationships) {
      it(`${relationship} sees, in a ${profile} profile, only the entries the rules allow`, async () => {
        const { owner, viewerOf } = await scene(profile);
        for (const level of levels) {
          await entry(owner.id, {
            visibility: level,
            title: `A ${level} entry`,
          });
        }

        const sections = await getProfileSections(
          db,
          owner.id,
          profile,
          relationship,
          "es",
        );

        const shown = sections.in_progress.entries.map((e) => e.title).sort();
        const want = levels
          .filter((level) => entryShows(relationship, profile, level))
          .map((level) => `A ${level} entry`)
          .sort();
        expect(shown).toEqual(want);
        expect(sections.in_progress.total).toBe(want.length);
        // The viewer of the scene is not needed for the query: the relationship says it all.
        expect(viewerOf).toBeDefined();
      });
    }
  }

  it("shows the three sections, newest first, and leaves out paused and dropped titles", async () => {
    const owner = await person("owner_one");
    await entry(owner.id, { status: "in_progress", title: "Watching" });
    await entry(owner.id, { status: "planned", title: "Planned" });
    await entry(owner.id, { status: "completed", title: "Done", score: 9 });
    await entry(owner.id, { status: "paused", title: "Paused" });
    await entry(owner.id, { status: "dropped", title: "Dropped" });

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "es",
    );

    expect(sections.in_progress.entries.map((e) => e.title)).toEqual([
      "Watching",
    ]);
    expect(sections.planned.entries.map((e) => e.title)).toEqual(["Planned"]);
    expect(sections.completed.entries).toMatchObject([
      { title: "Done", score: 9, type: "series" },
    ]);
    expect(JSON.stringify(sections)).not.toContain("Paused");
    expect(JSON.stringify(sections)).not.toContain("Dropped");
  });

  it("never reads the notes of an entry, however public the entry is", async () => {
    const owner = await person("owner_one");
    await entry(owner.id, {
      notes: "a private note about a public entry",
      visibility: "public",
    });

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "es",
    );

    expect(JSON.stringify(sections)).not.toContain("private note");
    expect(Object.keys(sections.in_progress.entries[0] ?? {}).sort()).toEqual([
      "imageUrl",
      "mediaId",
      "score",
      "title",
      "type",
      "year",
    ]);
  });

  it("writes the title in the language of the viewer", async () => {
    const owner = await person("owner_one");
    await entry(owner.id, {
      title: "Los Simpson",
      titles: { en: "The Simpsons" },
    });

    const english = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "en",
    );
    const spanish = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "es",
    );

    expect(english.in_progress.entries[0]?.title).toBe("The Simpsons");
    expect(spanish.in_progress.entries[0]?.title).toBe("Los Simpson");
  });

  it("shows a few of each section and says how many there are in all, newest changed first", async () => {
    const owner = await person("owner_one");
    for (let i = 0; i < entriesPerSection + 3; i += 1) {
      await entry(owner.id, { title: `Show ${i}` });
    }
    await db
      .update(libraryEntries)
      .set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(libraryEntries.userId, owner.id));
    const newest = await entry(owner.id, { title: "The newest" });

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "es",
    );

    expect(sections.in_progress.total).toBe(entriesPerSection + 4);
    expect(sections.in_progress.entries).toHaveLength(entriesPerSection);
    expect(sections.in_progress.entries[0]?.mediaId).toBe(newest.id);
  });

  it("reads only the entries of the owner", async () => {
    const owner = await person("owner_one");
    const other = await person("other_one");
    await entry(owner.id, { title: "Mine" });
    await entry(other.id, { title: "Theirs" });

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "es",
    );

    expect(sections.in_progress.entries.map((e) => e.title)).toEqual(["Mine"]);
  });

  it("is empty, without even asking the database, for a blocked person", async () => {
    const owner = await person("owner_one");
    await entry(owner.id);

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "blocked",
      "es",
    );

    expect(sections.in_progress).toEqual({ total: 0, entries: [] });
    // Sanity: the media table still holds the entry that was not shown.
    expect(await db.select().from(mediaItems)).toHaveLength(1);
  });
});

describe("the people a person blocked and muted", () => {
  it("lists only their own, newest first, without erased accounts", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_one");
    const cat = await person("cat_one");
    const gone = await person("gone_one");
    await db.insert(blocks).values([
      {
        blockerId: ana.id,
        blockedId: ben.id,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        blockerId: ana.id,
        blockedId: cat.id,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
      { blockerId: ana.id, blockedId: gone.id },
      // Somebody else's block of Ana is not hers to read.
      { blockerId: ben.id, blockedId: ana.id },
    ]);
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, gone.id));

    const blocked = await listBlocked(db, ana.id);

    expect(blocked.map((p) => p.username)).toEqual(["cat_one", "ben_one"]);
    expect(await listBlocked(db, cat.id)).toEqual([]);
  });

  it("lists and tells the mutes of the person who made them, and of nobody else", async () => {
    const ana = await person("ana_viewer");
    const ben = await person("ben_one");
    await muteUser(db, ana.id, "ben_one");

    expect((await listMuted(db, ana.id)).map((p) => p.username)).toEqual([
      "ben_one",
    ]);
    expect(await listMuted(db, ben.id)).toEqual([]);
    expect(await isMuted(db, ana.id, ben.id)).toBe(true);
    expect(await isMuted(db, ben.id, ana.id)).toBe(false);
  });

  it("shows a block that was just made", async () => {
    const ana = await person("ana_viewer");
    await person("ben_one");

    await blockUser(db, ana.id, "ben_one");

    expect((await listBlocked(db, ana.id)).map((p) => p.username)).toEqual([
      "ben_one",
    ]);
  });
});
