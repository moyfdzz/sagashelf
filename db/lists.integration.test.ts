import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  countOwnLists,
  createList,
  deleteList,
  getOwnList,
  listOwnLists,
  updateList,
} from "../server/db/lists";
import { listItems, lists } from "../server/db/schema";
import { maxLists, type ListFields } from "../server/lists/schema";
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

const fields = (overrides: Partial<ListFields> = {}): ListFields => ({
  title: "Best sci-fi",
  description: null,
  visibility: "private",
  ...overrides,
});

/** A list written straight into the table, so a test does not depend on `createList`. */
async function insertList(ownerId: string, title: string) {
  const [row] = await db.insert(lists).values({ ownerId, title }).returning();
  if (!row) throw new Error("The list was not created");
  return row;
}

describe("createList", () => {
  it("stores the list with what was asked, for the person that is given", async () => {
    const ana = await newUser();

    const result = await createList(
      db,
      ana.id,
      fields({
        title: "To watch with friends",
        description: "Nothing scary",
        visibility: "friends",
      }),
    );

    expect(result.outcome).toBe("created");
    const rows = await db.select().from(lists);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ownerId: ana.id,
      title: "To watch with friends",
      description: "Nothing scary",
      visibility: "friends",
    });
    expect(result.outcome === "created" && result.id).toBe(rows[0]?.id);
  });

  it("keeps an empty description as null and a list private when it is asked private", async () => {
    const ana = await newUser();

    await createList(db, ana.id, fields());

    const [row] = await db.select().from(lists);
    expect(row).toMatchObject({ description: null, visibility: "private" });
  });

  it("refuses a second list with the same title for the same person, and allows it to another", async () => {
    const ana = await newUser();
    const ben = await newUser();

    expect((await createList(db, ana.id, fields())).outcome).toBe("created");
    expect((await createList(db, ana.id, fields())).outcome).toBe("duplicate");
    expect((await createList(db, ben.id, fields())).outcome).toBe("created");

    const rows = await db.select().from(lists);
    expect(rows.map((row) => row.ownerId).sort()).toEqual(
      [ana.id, ben.id].sort(),
    );
  });

  it("answers a duplicate, and does not throw, when another form took the title a moment before", async () => {
    const ana = await newUser();
    // The other form is a transaction that has inserted the title and has not committed yet, so the
    // statement of `createList` cannot see it and has to wait for it at the unique index.
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("INSERT INTO lists (owner_id, title) VALUES ($1, $2)", [
        ana.id,
        "Best sci-fi",
      ]);
      const pending = createList(db, ana.id, fields());
      await new Promise((resolve) => setTimeout(resolve, 200));
      await other.query("COMMIT");

      expect((await pending).outcome).toBe("duplicate");
    } catch (error) {
      await other.query("ROLLBACK");
      throw error;
    } finally {
      other.release();
    }
    expect(await db.select().from(lists)).toHaveLength(1);
  });

  it("stops at the limit, and counts only the lists of that person", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await db.insert(lists).values(
      Array.from({ length: maxLists }, (_, index) => ({
        ownerId: ana.id,
        title: `List ${index}`,
      })),
    );

    expect((await createList(db, ana.id, fields())).outcome).toBe("limit");
    expect((await createList(db, ben.id, fields())).outcome).toBe("created");

    const anas = await db.select().from(lists).where(eq(lists.ownerId, ana.id));
    expect(anas).toHaveLength(maxLists);
  });

  it("allows the last list under the limit", async () => {
    const ana = await newUser();
    await db.insert(lists).values(
      Array.from({ length: maxLists - 1 }, (_, index) => ({
        ownerId: ana.id,
        title: `List ${index}`,
      })),
    );

    expect((await createList(db, ana.id, fields())).outcome).toBe("created");
    expect(
      (await createList(db, ana.id, fields({ title: "One more" }))).outcome,
    ).toBe("limit");
  });
});

describe("countOwnLists", () => {
  it("counts the lists of the person and no one else's", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await insertList(ana.id, "One");
    await insertList(ana.id, "Two");
    await insertList(ben.id, "Not hers");

    expect(await countOwnLists(db, ana.id)).toBe(2);
    expect(await countOwnLists(db, ben.id)).toBe(1);
  });

  it("is zero for a person with no lists", async () => {
    const ana = await newUser();

    expect(await countOwnLists(db, ana.id)).toBe(0);
  });
});

describe("listOwnLists and getOwnList", () => {
  it("lists only the lists of the person, the one changed last first, with how many titles each has", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const first = await insertList(ana.id, "First");
    const second = await insertList(ana.id, "Second");
    await insertList(ben.id, "Not hers");
    const movie = await newMedia({ title: "Arrival" });
    const other = await newMedia({ title: "Dune" });
    await db.insert(listItems).values([
      { listId: first.id, mediaId: movie.id },
      { listId: first.id, mediaId: other.id },
    ]);
    // `updated_at` is set by hand so the order does not depend on the clock.
    await db.execute(
      sql`UPDATE lists SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ${first.id}`,
    );
    await db.execute(
      sql`UPDATE lists SET updated_at = '2026-02-01T00:00:00Z' WHERE id = ${second.id}`,
    );

    const mine = await listOwnLists(db, ana.id);

    expect(mine.map((list) => [list.title, list.items])).toEqual([
      ["Second", 0],
      ["First", 2],
    ]);
  });

  it("returns a list to its owner, and null to anybody else or for an id that does not exist", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ana.id, "Mine");

    expect((await getOwnList(db, ana.id, list.id))?.title).toBe("Mine");
    expect(await getOwnList(db, ben.id, list.id)).toBeNull();
    expect(
      await getOwnList(db, ana.id, "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    ).toBeNull();
  });
});

describe("updateList", () => {
  it("changes the title, the description and the visibility, and moves the list up", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id, "Old name");
    await db.execute(
      sql`UPDATE lists SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ${list.id}`,
    );

    const result = await updateList(
      db,
      ana.id,
      list.id,
      fields({ title: "New name", description: "Why", visibility: "public" }),
    );

    expect(result).toBe("saved");
    const [row] = await db.select().from(lists);
    expect(row).toMatchObject({
      title: "New name",
      description: "Why",
      visibility: "public",
    });
    expect(row?.updatedAt.getTime()).toBeGreaterThan(
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
  });

  it("allows saving a list with its own title, and refuses the title of another list of the person", async () => {
    const ana = await newUser();
    const first = await insertList(ana.id, "First");
    await insertList(ana.id, "Second");

    expect(
      await updateList(db, ana.id, first.id, fields({ title: "First" })),
    ).toBe("saved");
    expect(
      await updateList(db, ana.id, first.id, fields({ title: "Second" })),
    ).toBe("duplicate");

    const [row] = await db.select().from(lists).where(eq(lists.id, first.id));
    expect(row?.title).toBe("First");
  });

  it("does not touch a list that is not the person's, and says it is not there", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ana.id, "Ana's");

    const result = await updateList(
      db,
      ben.id,
      list.id,
      fields({ title: "Taken over", visibility: "public" }),
    );

    expect(result).toBe("not_found");
    const [row] = await db.select().from(lists);
    expect(row).toMatchObject({ title: "Ana's", visibility: "private" });
  });
});

describe("deleteList", () => {
  it("deletes the list of the person with its titles, and nothing else", async () => {
    const ana = await newUser();
    const list = await insertList(ana.id, "Gone");
    const kept = await insertList(ana.id, "Kept");
    const movie = await newMedia();
    await db.insert(listItems).values([
      { listId: list.id, mediaId: movie.id },
      { listId: kept.id, mediaId: movie.id },
    ]);

    expect(await deleteList(db, ana.id, list.id)).toBe(true);

    expect((await db.select().from(lists)).map((row) => row.title)).toEqual([
      "Kept",
    ]);
    expect(await db.select().from(listItems)).toHaveLength(1);
  });

  it("does not delete a list that is not the person's, and says so", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const list = await insertList(ana.id, "Ana's");

    expect(await deleteList(db, ben.id, list.id)).toBe(false);
    expect(await deleteList(db, ana.id, list.id)).toBe(true);
    expect(await deleteList(db, ana.id, list.id)).toBe(false);
  });
});
