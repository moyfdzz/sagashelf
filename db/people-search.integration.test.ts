import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { eraseAccount } from "../server/db/erase-user";
import {
  normalizePeopleQuery,
  peopleSearchLimit,
  searchPeople,
} from "../server/db/people-search";
import { blocks, follows } from "../server/db/schema";
import { canSeeCard, levels } from "../server/social/can-view";
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

const person = (username: string, overrides = {}) =>
  newUser({ username, privacy: "public", ...overrides });

const usernames = (people: { username: string }[]) =>
  people.map((found) => found.username);

describe("searchPeople (SAG-115): who can be found", () => {
  // Written by hand on purpose: `private` is Total privacy, `friends` is Private on the screen.
  it.each([
    ["public", true],
    ["friends", true],
    ["private", false],
  ] as const)("a %s profile can be found: %s", async (privacy, found) => {
    const viewer = await person("viewer_one");
    await person("ana_reads", { privacy });

    const people = await searchPeople(db, viewer.id, "ana");

    expect(usernames(people)).toEqual(found ? ["ana_reads"] : []);
  });

  it("agrees with the one policy of who has a card", () => {
    expect(levels.filter((level) => canSeeCard("stranger", level))).toEqual([
      "public",
      "friends",
    ]);
  });

  it("a friend does not find a person with total privacy either", async () => {
    const viewer = await person("viewer_one");
    const hidden = await person("ana_reads", { privacy: "private" });
    await db.insert(follows).values([
      { followerId: viewer.id, followeeId: hidden.id },
      { followerId: hidden.id, followeeId: viewer.id },
    ]);

    expect(await searchPeople(db, viewer.id, "ana")).toEqual([]);
  });

  it("gives only the card, never the bio, of any profile", async () => {
    const viewer = await person("viewer_one");
    await person("ana_public", { displayName: "Ana", bio: "a secret bio" });
    await person("ana_locked", { privacy: "friends", bio: "another secret" });

    const people = await searchPeople(db, viewer.id, "ana");

    expect(people).toEqual([
      { username: "ana_locked", displayName: null, avatarUrl: null },
      { username: "ana_public", displayName: "Ana", avatarUrl: null },
    ]);
  });

  it("leaves out the person who searches", async () => {
    const viewer = await person("ana_reads");

    expect(await searchPeople(db, viewer.id, "ana")).toEqual([]);
  });

  it("leaves out an erased account, by its old name and by its new one", async () => {
    const viewer = await person("viewer_one");
    await person("ana_reads", { clerkId: "user_ana" });
    await eraseAccount(db, "user_ana");

    expect(await searchPeople(db, viewer.id, "ana")).toEqual([]);
    expect(await searchPeople(db, viewer.id, "deleted")).toEqual([]);
  });

  it("leaves out a person the viewer blocked", async () => {
    const viewer = await person("viewer_one");
    const ana = await person("ana_reads");
    await db.insert(blocks).values({ blockerId: viewer.id, blockedId: ana.id });

    expect(await searchPeople(db, viewer.id, "ana")).toEqual([]);
  });

  it("leaves out a person who blocked the viewer", async () => {
    const viewer = await person("viewer_one");
    const ana = await person("ana_reads");
    await db.insert(blocks).values({ blockerId: ana.id, blockedId: viewer.id });

    expect(await searchPeople(db, viewer.id, "ana")).toEqual([]);
  });

  it("a block of somebody else does not hide a person", async () => {
    const viewer = await person("viewer_one");
    const other = await person("other_one");
    const ana = await person("ana_reads");
    await db.insert(blocks).values({ blockerId: other.id, blockedId: ana.id });

    expect(usernames(await searchPeople(db, viewer.id, "ana"))).toEqual([
      "ana_reads",
    ]);
  });
});

describe("searchPeople (SAG-115): what matches", () => {
  it("finds by the start of the username and not by the middle", async () => {
    const viewer = await person("viewer_one");
    await person("ana_reads");
    await person("mariana");

    expect(usernames(await searchPeople(db, viewer.id, "ana"))).toEqual([
      "ana_reads",
    ]);
  });

  it("does not care about the case", async () => {
    const viewer = await person("viewer_one");
    await person("Ana_Reads");

    const people = await searchPeople(
      db,
      viewer.id,
      normalizePeopleQuery("  @aNA "),
    );

    expect(usernames(people)).toEqual(["Ana_Reads"]);
  });

  it.each(["%", "__", "a%", "a_", "\\", "a\\"])(
    "searches %s as plain text, not as a pattern",
    async (query) => {
      const viewer = await person("viewer_one");
      await person("abc_def");
      await person("axbycz");

      expect(await searchPeople(db, viewer.id, query)).toEqual([]);
    },
  );

  it("an underscore matches an underscore", async () => {
    const viewer = await person("viewer_one");
    await person("ab_cd");
    await person("abxcd");

    expect(usernames(await searchPeople(db, viewer.id, "ab_"))).toEqual([
      "ab_cd",
    ]);
  });

  it("gives a limited number of people, in order, with no way to ask for more", async () => {
    const viewer = await person("viewer_one");
    for (let i = peopleSearchLimit + 5; i > 0; i--) {
      await person(`same_${String(i).padStart(2, "0")}`);
    }

    const people = await searchPeople(db, viewer.id, "same");

    expect(people).toHaveLength(peopleSearchLimit);
    expect(people[0]?.username).toBe("same_01");
    expect(people.at(-1)?.username).toBe(
      `same_${String(peopleSearchLimit).padStart(2, "0")}`,
    );
  });
});
