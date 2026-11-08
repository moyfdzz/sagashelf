import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addListItem,
  listItemsOf,
  listsForTitle,
  moveListItem,
  removeListItem,
  saveListItemNote,
} from "../server/db/list-items";
import { customEntries, listItems, lists } from "../server/db/schema";
import { maxListItems } from "../server/lists/schema";
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

/** A value of a list that the test knows is there, without a `!` (the lint forbids it). */
function pick<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("The test expected a value");
  return value;
}

/** A list written straight into the table, so a test does not depend on `createList`. */
async function insertList(ownerId: string, title = "Best sci-fi") {
  const [row] = await db.insert(lists).values({ ownerId, title }).returning();
  if (!row) throw new Error("The list was not created");
  return row;
}

/** The titles of a list as `[media id, position]` in the order the page would show them. */
async function order(listId: string) {
  const rows = await db
    .select({ mediaId: listItems.mediaId, position: listItems.position })
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position), asc(listItems.createdAt));
  return rows.map((row) => row.mediaId);
}

async function fill(listId: string, titles: number) {
  const made = [];
  for (let index = 0; index < titles; index += 1) {
    made.push(await newMedia({ title: `Title ${index}` }));
  }
  for (const [index, media] of made.entries()) {
    await db
      .insert(listItems)
      .values({ listId, mediaId: media.id, position: index });
  }
  return made.map((media) => media.id);
}

describe("addListItem", () => {
  it("puts the title at the end, and the second one after it", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const [dune, arrival] = [await newMedia(), await newMedia()];

    expect(await addListItem(db, ana.id, list.id, dune.id)).toBe("added");
    expect(await addListItem(db, ana.id, list.id, arrival.id)).toBe("added");

    const rows = await db
      .select()
      .from(listItems)
      .orderBy(asc(listItems.position));
    expect(rows.map((row) => [row.mediaId, row.position])).toEqual([
      [dune.id, 0],
      [arrival.id, 1],
    ]);
  });

  it("says already for a title that is in the list, and changes nothing", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const dune = await newMedia();
    await addListItem(db, ana.id, list.id, dune.id);

    expect(await addListItem(db, ana.id, list.id, dune.id)).toBe("already");

    expect(await db.select().from(listItems)).toHaveLength(1);
  });

  it("answers not_found for a list of someone else, and writes nothing", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ben.id);
    const dune = await newMedia();

    expect(await addListItem(db, ana.id, list.id, dune.id)).toBe("not_found");

    expect(await db.select().from(listItems)).toHaveLength(0);
  });

  it("answers not_found for a list that does not exist and for a title that does not", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const dune = await newMedia();
    const nobody = "0199a3c2-7d4e-7b1a-8c3f-000000000000";

    expect(await addListItem(db, ana.id, nobody, dune.id)).toBe("not_found");
    expect(await addListItem(db, ana.id, list.id, nobody)).toBe("not_found");
    expect(await db.select().from(listItems)).toHaveLength(0);
  });

  it("takes a custom title of the person, and refuses the one of another person", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ana.id);
    const mine = await newMedia({ type: "custom", title: "Mine" });
    const his = await newMedia({ type: "custom", title: "His" });
    await db.insert(customEntries).values([
      { mediaId: mine.id, ownerId: ana.id },
      { mediaId: his.id, ownerId: ben.id },
    ]);

    expect(await addListItem(db, ana.id, list.id, his.id)).toBe("not_found");
    expect(await addListItem(db, ana.id, list.id, mine.id)).toBe("added");

    expect(await order(list.id)).toEqual([mine.id]);
  });

  it("stops at the limit, and allows the last title under it", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const media = await newMedia();
    await db.execute(sql`
      INSERT INTO media_items (type, title)
      SELECT 'movie', 'Filler ' || n FROM generate_series(1, ${maxListItems - 1}) AS n
    `);
    await db.execute(sql`
      INSERT INTO list_items (list_id, media_id, position)
      SELECT ${list.id}::uuid, id, 0 FROM media_items WHERE title LIKE 'Filler %'
    `);

    expect(await addListItem(db, ana.id, list.id, media.id)).toBe("added");
    const extra = await newMedia();
    expect(await addListItem(db, ana.id, list.id, extra.id)).toBe("limit");

    expect(await db.select().from(listItems)).toHaveLength(maxListItems);
  });

  it("says already, not limit, for a title that is in a full list", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const ids = await fill(list.id, maxListItems);

    expect(await addListItem(db, ana.id, list.id, pick(ids[0]))).toBe(
      "already",
    );

    expect(await db.select().from(listItems)).toHaveLength(maxListItems);
  });

  it("moves the list up the page of the lists, since it changed", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    await db.execute(
      sql`UPDATE lists SET updated_at = now() - interval '1 day' WHERE id = ${list.id}`,
    );
    const before = (await db.select().from(lists))[0]?.updatedAt;

    await addListItem(db, ana.id, list.id, (await newMedia()).id);

    const after = (await db.select().from(lists))[0]?.updatedAt;
    expect(after && before && after > before).toBe(true);
  });
});

describe("removeListItem", () => {
  it("takes out only that title of that list", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const other = await insertList(ana.id, "Weekend");
    const [one, two] = await fill(list.id, 2);
    await db.insert(listItems).values({ listId: other.id, mediaId: pick(one) });

    expect(await removeListItem(db, ana.id, list.id, pick(one))).toBe(true);

    expect(await order(list.id)).toEqual([two]);
    expect(await order(other.id)).toEqual([one]);
  });

  it("does nothing for a list of someone else, and says false", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ben.id);
    const [one] = await fill(list.id, 1);

    expect(await removeListItem(db, ana.id, list.id, pick(one))).toBe(false);

    expect(await order(list.id)).toEqual([one]);
  });

  it("says false for a title that is not in the list", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const loose = await newMedia();

    expect(await removeListItem(db, ana.id, list.id, loose.id)).toBe(false);
  });
});

describe("saveListItemNote", () => {
  it("writes the note, and null clears it", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const [one] = await fill(list.id, 1);

    expect(await saveListItemNote(db, ana.id, list.id, pick(one), "Gift")).toBe(
      true,
    );
    expect((await db.select().from(listItems))[0]?.note).toBe("Gift");

    expect(await saveListItemNote(db, ana.id, list.id, pick(one), null)).toBe(
      true,
    );
    expect((await db.select().from(listItems))[0]?.note).toBeNull();
  });

  it("does not write a note on a list of someone else", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ben.id);
    const [one] = await fill(list.id, 1);

    expect(
      await saveListItemNote(db, ana.id, list.id, pick(one), "Mine now"),
    ).toBe(false);

    expect((await db.select().from(listItems))[0]?.note).toBeNull();
  });
});

describe("moveListItem", () => {
  it("swaps a title with the one before it, and with the one after it", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const [a, b, c] = await fill(list.id, 3);

    expect(await moveListItem(db, ana.id, list.id, pick(c), "up")).toBe(true);
    expect(await order(list.id)).toEqual([a, c, b]);

    expect(await moveListItem(db, ana.id, list.id, pick(a), "down")).toBe(true);
    expect(await order(list.id)).toEqual([c, a, b]);
  });

  it("leaves the order as it is at the ends, and still says true", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const [a, b] = await fill(list.id, 2);

    await db.execute(
      sql`UPDATE lists SET updated_at = now() - interval '1 day' WHERE id = ${list.id}`,
    );
    const before = (await db.select().from(lists))[0]?.updatedAt;

    expect(await moveListItem(db, ana.id, list.id, pick(a), "up")).toBe(true);
    expect(await moveListItem(db, ana.id, list.id, pick(b), "down")).toBe(true);

    expect(await order(list.id)).toEqual([a, b]);
    // Nothing was written: the positions are the same and the list did not move up the page.
    const rows = await db
      .select()
      .from(listItems)
      .orderBy(asc(listItems.position));
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
    expect((await db.select().from(lists))[0]?.updatedAt).toEqual(before);
  });

  it("puts titles that share a position in a clear order first, then moves one", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    const [a, b, c] = [await newMedia(), await newMedia(), await newMedia()];
    // The first PR left every position at 0: the order is the one of `created_at`, then the id.
    await db.execute(sql`
      INSERT INTO list_items (list_id, media_id, position, created_at)
      VALUES (${list.id}::uuid, ${a.id}::uuid, 0, now() - interval '3 minutes'),
             (${list.id}::uuid, ${b.id}::uuid, 0, now() - interval '2 minutes'),
             (${list.id}::uuid, ${c.id}::uuid, 0, now() - interval '1 minute')
    `);

    expect(await moveListItem(db, ana.id, list.id, c.id, "up")).toBe(true);

    expect(await order(list.id)).toEqual([a.id, c.id, b.id]);
    // The order is numbered again, from 0, by the move.
    const positions = (await db.select().from(listItems)).map(
      (row) => row.position,
    );
    expect(positions.sort()).toEqual([0, 1, 2]);
  });

  it("does not move the titles of a list of someone else", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ben.id);
    const [a, b] = await fill(list.id, 2);

    expect(await moveListItem(db, ana.id, list.id, pick(b), "up")).toBe(false);

    expect(await order(list.id)).toEqual([a, b]);
  });

  it("says false for a title that is not in the list", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id);
    await fill(list.id, 2);
    const loose = await newMedia();

    expect(await moveListItem(db, ana.id, list.id, loose.id, "up")).toBe(false);
  });
});

describe("listItemsOf and listsForTitle", () => {
  it("gives the titles in order, in the language asked, only for the owner", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ana.id);
    const first = await newMedia({
      title: "Dune",
      titles: { es: "Duna" },
      year: 2021,
    });
    const second = await newMedia({ title: "Arrival" });
    await addListItem(db, ana.id, list.id, first.id);
    await addListItem(db, ana.id, list.id, second.id);
    await saveListItemNote(db, ana.id, list.id, first.id, "Gift");

    const spanish = await listItemsOf(db, ana.id, list.id, "es");
    const english = await listItemsOf(db, ana.id, list.id, "en");

    expect(spanish.map((item) => [item.title, item.note, item.year])).toEqual([
      ["Duna", "Gift", 2021],
      ["Arrival", null, null],
    ]);
    expect(english.map((item) => item.title)).toEqual(["Dune", "Arrival"]);
    expect(await listItemsOf(db, ben.id, list.id, "es")).toEqual([]);
  });

  it("says, for each list of the person, whether it has the title", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const weekend = await insertList(ana.id, "Weekend");
    const scifi = await insertList(ana.id, "Best sci-fi");
    await insertList(ben.id, "His list");
    const dune = await newMedia();
    await addListItem(db, ana.id, weekend.id, dune.id);

    const result = await listsForTitle(db, ana.id, dune.id);

    expect(result).toEqual([
      { id: scifi.id, title: "Best sci-fi", has: false },
      { id: weekend.id, title: "Weekend", has: true },
    ]);
  });
});
