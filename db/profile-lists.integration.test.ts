import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getViewableList,
  listViewableItems,
  listViewableLists,
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

describe("listViewableLists", () => {
  it("gives only the lists whose level is allowed, and the three when all are", async () => {
    const { owner } = await ownerWithThreeLists();

    expect(titlesOf(await listViewableLists(db, owner.id, ["public"]))).toEqual(
      ["Open"],
    );
    expect(
      titlesOf(
        await listViewableLists(db, owner.id, ["public", "friends"]),
      ).sort(),
    ).toEqual(["Friends", "Open"]);
    expect(
      titlesOf(
        await listViewableLists(db, owner.id, ["public", "friends", "private"]),
      ).sort(),
    ).toEqual(["Closed", "Friends", "Open"]);
  });

  it("gives nothing, without asking the database, when no level is allowed", async () => {
    const { owner } = await ownerWithThreeLists();

    expect(await listViewableLists(db, owner.id, [])).toEqual([]);
  });

  it("never gives a list of somebody else", async () => {
    const { owner } = await ownerWithThreeLists();
    const other = await newUser();
    await insertList(other.id, "Theirs", "public");

    expect(titlesOf(await listViewableLists(db, owner.id, ["public"]))).toEqual(
      ["Open"],
    );
  });

  it("counts the titles of each list", async () => {
    const { owner, open } = await ownerWithThreeLists();
    const first = await newMedia({ title: "One" });
    const second = await newMedia({ title: "Two" });
    await db.insert(listItems).values([
      { listId: open.id, mediaId: first.id, position: 0 },
      { listId: open.id, mediaId: second.id, position: 1 },
    ]);

    const [row] = await listViewableLists(db, owner.id, ["public"]);

    expect(row?.items).toBe(2);
  });
});

describe("getViewableList", () => {
  it("gives a list of the owner at an allowed level", async () => {
    const { owner, mid } = await ownerWithThreeLists();

    const found = await getViewableList(db, owner.id, mid.id, [
      "public",
      "friends",
    ]);

    expect(found?.title).toBe("Friends");
    expect(found?.visibility).toBe("friends");
  });

  it("is null for a list above the allowed levels, as if it were not there", async () => {
    const { owner, mid, closed } = await ownerWithThreeLists();

    expect(await getViewableList(db, owner.id, mid.id, ["public"])).toBeNull();
    expect(
      await getViewableList(db, owner.id, closed.id, ["public", "friends"]),
    ).toBeNull();
    expect(await getViewableList(db, owner.id, closed.id, [])).toBeNull();
  });

  it("is null for the list of somebody else, whatever its level, and for an id that is not there", async () => {
    const { open } = await ownerWithThreeLists();
    const other = await newUser();

    expect(await getViewableList(db, other.id, open.id, ["public"])).toBeNull();
    expect(
      await getViewableList(
        db,
        other.id,
        "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
        ["public"],
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
      ["public"],
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

  it("gives nothing for a list above the allowed levels, of somebody else, or with no level allowed", async () => {
    const { owner, closed, open } = await ownerWithThreeLists();
    const other = await newUser();
    const media = await newMedia({ title: "Hidden" });
    await db.insert(listItems).values([
      { listId: closed.id, mediaId: media.id, position: 0 },
      { listId: open.id, mediaId: media.id, position: 0 },
    ]);

    expect(
      await listViewableItems(
        db,
        owner.id,
        closed.id,
        ["public", "friends"],
        "es",
      ),
    ).toEqual([]);
    expect(
      await listViewableItems(db, other.id, open.id, ["public"], "es"),
    ).toEqual([]);
    expect(await listViewableItems(db, owner.id, open.id, [], "es")).toEqual(
      [],
    );
  });
});
