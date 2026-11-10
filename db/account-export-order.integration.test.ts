import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import {
  customEntries,
  libraryEntries,
  libraryViewings,
  listItems,
  lists,
} from "../server/db/schema";
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

// Every row below gets the same timestamp, so only the tie-breaker can put them in order. The
// export has to be the same file every time (SAG-173).
const sameMoment = new Date("2026-03-01T10:00:00.000Z");
const now = new Date("2026-11-10T12:00:00.000Z");

// Ids are time-ordered (uuidv7), so rows inserted in a row come out in id order by luck. These are
// written in the opposite order, so a missing ORDER BY would show.
const fixedId = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const backwards = <T>(rows: T[]) => [...rows].reverse();

describe("the order of an account export", () => {
  it("lists library entries, viewings and custom entries in a fixed order", async () => {
    const ana = await newUser();
    const media: Awaited<ReturnType<typeof newMedia>>[] = [];
    for (const title of ["Delta", "Alpha", "Charlie", "Bravo"]) {
      media.push(await newMedia({ title }));
    }

    const entries = await db
      .insert(libraryEntries)
      .values(
        backwards(media).map((item, index) => ({
          id: fixedId(media.length - index),
          userId: ana.id,
          mediaId: item.id,
          status: "completed" as const,
          createdAt: sameMoment,
        })),
      )
      .returning({ id: libraryEntries.id, mediaId: libraryEntries.mediaId });
    // The expected order is written here and not asked of the function: by id.
    const titleOf = (mediaId: string) =>
      media.find((item) => item.id === mediaId)?.title;
    const expectedTitles = [...entries]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => titleOf(entry.mediaId));

    const own: Awaited<ReturnType<typeof newMedia>>[] = [];
    for (const title of ["Zeta", "Eta", "Theta"]) {
      own.push(await newMedia({ title, type: "book" }));
    }
    await db.insert(customEntries).values(
      backwards(own).map((item) => ({
        ownerId: ana.id,
        mediaId: item.id,
        createdAt: sameMoment,
      })),
    );
    const expectedCustom = [...own]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => item.title);

    const first = await exportAccount(db, ana.id, now);
    const second = await exportAccount(db, ana.id, now);

    expect(first?.libraryEntries.map((entry) => entry.title)).toEqual(
      expectedTitles,
    );
    expect(first?.customEntries.map((entry) => entry.title)).toEqual(
      expectedCustom,
    );
    expect(second).toEqual(first);
  });

  it("lists the lists and their items in a fixed order", async () => {
    const ana = await newUser();
    const media: Awaited<ReturnType<typeof newMedia>>[] = [];
    for (const title of ["One", "Two", "Three"]) {
      media.push(await newMedia({ title }));
    }
    const made = await db
      .insert(lists)
      .values(
        backwards(["Favorites", "Pending", "Classics"]).map((title, index) => ({
          id: fixedId(3 - index),
          ownerId: ana.id,
          title,
          createdAt: sameMoment,
        })),
      )
      .returning({ id: lists.id, title: lists.title });
    const expectedLists = [...made]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((list) => list.title);

    // Three titles on the same position: only the media id tells them apart.
    const target = made[0];
    if (!target) throw new Error("The lists were not created");
    await db.insert(listItems).values(
      backwards(media).map((item) => ({
        listId: target.id,
        mediaId: item.id,
        position: 1,
        createdAt: sameMoment,
      })),
    );
    const expectedItems = [...media]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => item.title);

    const first = await exportAccount(db, ana.id, now);
    const second = await exportAccount(db, ana.id, now);

    expect(first?.lists.map((list) => list.title)).toEqual(expectedLists);
    const exported = first?.lists.find((list) => list.title === target.title);
    expect(exported?.items.map((item) => item.title)).toEqual(expectedItems);
    expect(second).toEqual(first);
  });

  it("keeps the viewings of one entry in a fixed order when their dates tie", async () => {
    const ana = await newUser();
    const film = await newMedia({ title: "Film" });
    const [entry] = await db
      .insert(libraryEntries)
      .values({ userId: ana.id, mediaId: film.id, status: "completed" })
      .returning({ id: libraryEntries.id });
    if (!entry) throw new Error("The entry was not created");
    const made = await db
      .insert(libraryViewings)
      .values(
        backwards(["first", "second", "third"]).map((notes, index) => ({
          id: fixedId(3 - index),
          entryId: entry.id,
          finishedOn: "2026-01-01",
          notes,
          createdAt: sameMoment,
        })),
      )
      .returning({ id: libraryViewings.id, notes: libraryViewings.notes });
    const expectedNotes = [...made]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((viewing) => viewing.notes);

    const first = await exportAccount(db, ana.id, now);
    const second = await exportAccount(db, ana.id, now);

    const viewings = first?.libraryEntries[0]?.viewings as { notes: string }[];
    expect(viewings.map((viewing) => viewing.notes)).toEqual(expectedNotes);
    expect(second).toEqual(first);
  });
});
