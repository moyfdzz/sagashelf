import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getProfileSectionPage,
  getProfileSections,
} from "../server/db/profile-library";
import {
  listViewableItems,
  type ListViewing,
} from "../server/db/profile-lists";
import {
  customEntries,
  libraryEntries,
  listItems,
  lists,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

// SAG-196: a title a person made for themselves (type `custom`) never comes out of a query that
// shows titles to somebody else, even when the list or the entry holding it is shared.

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
});

const stranger: ListViewing = {
  relationship: "stranger",
  profileLevel: "public",
};
const mine: ListViewing = { relationship: "owner", profileLevel: "public" };

/** An owner with a public list and a public library entry for a catalog title and a custom one. */
async function ownerWithOneCustomTitle() {
  const owner = await newUser();
  const catalog = await newMedia({ title: "Catalog title", type: "movie" });
  const custom = await newMedia({ title: "My private idea", type: "custom" });
  await db
    .insert(customEntries)
    .values({ mediaId: custom.id, ownerId: owner.id });

  const [list] = await db
    .insert(lists)
    .values({ ownerId: owner.id, title: "Shared", visibility: "public" })
    .returning();
  if (!list) throw new Error("The list was not created");
  await db.insert(listItems).values([
    { listId: list.id, mediaId: catalog.id, position: 0 },
    { listId: list.id, mediaId: custom.id, position: 1 },
  ]);

  await db.insert(libraryEntries).values([
    { userId: owner.id, mediaId: catalog.id, visibility: "public" },
    { userId: owner.id, mediaId: custom.id, visibility: "public" },
  ]);
  return { owner, catalog, custom, list };
}

describe("a custom title and the people who may see a shared list or entry", () => {
  it("is not in the titles of a shared list for another viewer", async () => {
    const { owner, list } = await ownerWithOneCustomTitle();

    const items = await listViewableItems(
      db,
      owner.id,
      list.id,
      stranger,
      "en",
    );

    expect(items.map((item) => item.title)).toEqual(["Catalog title"]);
  });

  it("is in the titles of the list for the owner", async () => {
    const { owner, list } = await ownerWithOneCustomTitle();

    const items = await listViewableItems(db, owner.id, list.id, mine, "en");

    expect(items.map((item) => item.title)).toEqual([
      "Catalog title",
      "My private idea",
    ]);
  });

  it("is not in the sections of a profile for another viewer", async () => {
    const { owner } = await ownerWithOneCustomTitle();

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "stranger",
      "en",
    );

    expect(sections.planned.entries.map((entry) => entry.title)).toEqual([
      "Catalog title",
    ]);
    expect(sections.planned.total).toBe(1);
  });

  it("is not in a page of a section nor in its counts for another viewer", async () => {
    const { owner } = await ownerWithOneCustomTitle();

    const page = await getProfileSectionPage(
      db,
      owner.id,
      "public",
      "stranger",
      {
        status: "planned",
        type: null,
        page: 1,
        locale: "en",
      },
    );

    expect(page.entries.map((entry) => entry.title)).toEqual(["Catalog title"]);
    expect(page.counts.all).toBe(1);
  });

  it("is in the sections of the profile for the owner", async () => {
    const { owner } = await ownerWithOneCustomTitle();

    const sections = await getProfileSections(
      db,
      owner.id,
      "public",
      "owner",
      "en",
    );

    expect(sections.planned.entries.map((entry) => entry.title).sort()).toEqual(
      ["Catalog title", "My private idea"],
    );
  });
});
