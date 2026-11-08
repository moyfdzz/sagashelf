import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getViewableList,
  listViewableItems,
  listViewableLists,
  type ListViewing,
} from "../server/db/profile-lists";
import { listItems, lists } from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

type Level = "public" | "friends" | "private";

async function insertList(ownerId: string, title: string, visibility: Level) {
  const [row] = await db
    .insert(lists)
    .values({ ownerId, title, visibility })
    .returning();
  if (!row) throw new Error("The list was not created");
  return row;
}

/** An owner with one list of each level, written straight into the tables. */
async function ownerWithThreeLists() {
  const owner = await newUser();
  const open = await insertList(owner.id, "Open", "public");
  const mid = await insertList(owner.id, "Friends", "friends");
  const closed = await insertList(owner.id, "Closed", "private");
  return { owner, open, mid, closed };
}

const titlesOf = (rows: { title: string }[]) => rows.map((row) => row.title);

/** Somebody who can see the public lists of a public profile and nothing more. */
const stranger: ListViewing = {
  relationship: "stranger",
  profileLevel: "public",
};
/** A friend of the owner of a profile that is for friends: sees the public and friends lists. */
const friend: ListViewing = { relationship: "friend", profileLevel: "friends" };
/** The owner: sees everything. */
const mine: ListViewing = { relationship: "owner", profileLevel: "public" };

describe("listViewableLists", () => {
  it("gives only the lists whose level the viewer may see, and the three to the owner", async () => {
    const { owner } = await ownerWithThreeLists();

    expect(titlesOf(await listViewableLists(db, owner.id, stranger))).toEqual([
      "Open",
    ]);
    expect(
      titlesOf(await listViewableLists(db, owner.id, friend)).sort(),
    ).toEqual(["Friends", "Open"]);
    expect(
      titlesOf(await listViewableLists(db, owner.id, mine)).sort(),
    ).toEqual(["Closed", "Friends", "Open"]);
  });

  it("gives nothing, without asking the database, when no level may be seen", async () => {
    const { owner } = await ownerWithThreeLists();

    expect(
      await listViewableLists(db, owner.id, {
        relationship: "blocked",
        profileLevel: "public",
      }),
    ).toEqual([]);
  });

  it("never gives a list of somebody else", async () => {
    const { owner } = await ownerWithThreeLists();
    const other = await newUser();
    await insertList(other.id, "Theirs", "public");

    expect(titlesOf(await listViewableLists(db, owner.id, stranger))).toEqual([
      "Open",
    ]);
  });

  it("counts the titles of each list, and gives nothing but what the page needs", async () => {
    const { owner, open } = await ownerWithThreeLists();
    const first = await newMedia({ title: "One" });
    const second = await newMedia({ title: "Two" });
    await db.insert(listItems).values([
      { listId: open.id, mediaId: first.id, position: 0 },
      { listId: open.id, mediaId: second.id, position: 1 },
    ]);

    const [row] = await listViewableLists(db, owner.id, stranger);

    expect(row?.items).toBe(2);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "description",
      "id",
      "items",
      "title",
    ]);
  });

  it("gives the list changed last first", async () => {
    const { owner, open, mid } = await ownerWithThreeLists();
    await db.execute(
      sql`UPDATE lists SET updated_at = now() - interval '1 day' WHERE id = ${open.id}`,
    );
    await db.execute(
      sql`UPDATE lists SET updated_at = now() WHERE id = ${mid.id}`,
    );

    expect(titlesOf(await listViewableLists(db, owner.id, friend))).toEqual([
      "Friends",
      "Open",
    ]);
  });
});

describe("getViewableList", () => {
  it("gives a list of the owner at a level the viewer may see", async () => {
    const { owner, mid } = await ownerWithThreeLists();

    const found = await getViewableList(db, owner.id, mid.id, friend);

    expect(found?.title).toBe("Friends");
  });

  it("is null for a list above what the viewer may see, as if it were not there", async () => {
    const { owner, mid, closed } = await ownerWithThreeLists();

    expect(await getViewableList(db, owner.id, mid.id, stranger)).toBeNull();
    expect(await getViewableList(db, owner.id, closed.id, friend)).toBeNull();
    expect(
      await getViewableList(db, owner.id, mid.id, {
        relationship: "blocked",
        profileLevel: "public",
      }),
    ).toBeNull();
  });

  it("is null for the list of somebody else, whatever its level, and for an id that is not there", async () => {
    const { open } = await ownerWithThreeLists();
    const other = await newUser();

    expect(await getViewableList(db, other.id, open.id, stranger)).toBeNull();
    expect(
      await getViewableList(
        db,
        other.id,
        "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
        stranger,
      ),
    ).toBeNull();
  });
});

describe("listViewableItems", () => {
  it("gives the titles in the order the owner chose and no note", async () => {
    const { owner, open } = await ownerWithThreeLists();
    const a = await newMedia({ title: "Alpha", year: 2001 });
    const b = await newMedia({ title: "Beta" });
    const c = await newMedia({ title: "Gamma" });
    await db.insert(listItems).values([
      { listId: open.id, mediaId: a.id, position: 2, note: "My secret note" },
      { listId: open.id, mediaId: b.id, position: 0 },
      { listId: open.id, mediaId: c.id, position: 1 },
    ]);

    const items = await listViewableItems(
      db,
      owner.id,
      open.id,
      stranger,
      "en",
    );

    expect(items.map((item) => item.title)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(items[2]?.year).toBe(2001);
    expect(JSON.stringify(items)).not.toContain("secret");
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "mediaId",
      "title",
      "type",
      "year",
    ]);
  });

  it("gives nothing for a list above what the viewer may see, of somebody else, or to a blocked viewer", async () => {
    const { owner, closed, open } = await ownerWithThreeLists();
    const other = await newUser();
    const media = await newMedia({ title: "Hidden" });
    await db.insert(listItems).values([
      { listId: closed.id, mediaId: media.id, position: 0 },
      { listId: open.id, mediaId: media.id, position: 0 },
    ]);

    expect(
      await listViewableItems(db, owner.id, closed.id, friend, "es"),
    ).toEqual([]);
    expect(
      await listViewableItems(db, other.id, open.id, stranger, "es"),
    ).toEqual([]);
    expect(
      await listViewableItems(
        db,
        owner.id,
        open.id,
        { relationship: "blocked", profileLevel: "public" },
        "es",
      ),
    ).toEqual([]);
  });
});

/**
 * What a route can read through these functions, for every way of looking at every profile (ADR-045):
 * the strictest of the level of the list and the level of the profile decides. The table is written
 * by hand (the same cases as `visibleListLevels`), not asked of the function under test, and it is
 * checked through the three functions a route calls, so none of them can show a list above its level.
 */
describe("what a route can read, by who is looking (SAG-163)", () => {
  const all = ["Open", "Friends", "Closed"];
  const upToFriends = ["Open", "Friends"];

  it.each([
    ["owner", "public", all],
    ["owner", "friends", all],
    ["friend", "public", upToFriends],
    ["friend", "friends", upToFriends],
    ["follower", "public", ["Open"]],
    ["stranger", "public", ["Open"]],
    ["signed_out", "public", ["Open"]],
    ["follower", "friends", []],
    ["stranger", "friends", []],
    ["friend", "private", []],
    ["stranger", "private", []],
    ["blocked", "public", []],
    ["blocked", "friends", []],
  ] as const)(
    "a %s of a %s profile reads the lists %j and no others, with their titles",
    async (relationship, profileLevel, visible) => {
      const { owner, open, mid, closed } = await ownerWithThreeLists();
      const media = await newMedia({ title: "Inside" });
      await db.insert(listItems).values(
        [open, mid, closed].map((list) => ({
          listId: list.id,
          mediaId: media.id,
          position: 0,
        })),
      );
      const viewing: ListViewing = { relationship, profileLevel };

      expect(
        titlesOf(await listViewableLists(db, owner.id, viewing)).sort(),
      ).toEqual([...visible].sort());

      for (const [name, list] of [
        ["Open", open],
        ["Friends", mid],
        ["Closed", closed],
      ] as const) {
        const seen = visible.some((title) => title === name);
        expect(
          (await getViewableList(db, owner.id, list.id, viewing))?.title,
        ).toBe(seen ? name : undefined);
        expect(
          (await listViewableItems(db, owner.id, list.id, viewing, "en"))
            .length,
        ).toBe(seen ? 1 : 0);
      }
    },
  );
});
