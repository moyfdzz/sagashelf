import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  entriesPerPage,
  getProfileSectionPage,
  maxSectionPage,
} from "../server/db/profile-library";
import { libraryEntries } from "../server/db/schema";
import type { Level, Relationship } from "../server/social/can-view";
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

let counter = 0;

/** One entry of the library of a person, with its own title. */
async function entry(
  userId: string,
  overrides: Partial<typeof libraryEntries.$inferInsert> & {
    title?: string;
    type?: "movie" | "series" | "anime" | "book" | "manga" | "custom";
    titles?: Record<string, string>;
  } = {},
) {
  counter += 1;
  const { title, type, titles, ...values } = overrides;
  const media = await newMedia({
    type: type ?? "movie",
    title: title ?? `Title ${counter}`,
    titles: titles ?? {},
  });
  await db.insert(libraryEntries).values({
    userId,
    mediaId: media.id,
    status: "completed",
    visibility: "public",
    ...values,
  });
  return media;
}

const ask = (
  ownerId: string,
  query: {
    profile?: Level;
    relationship?: Relationship;
    status?: "in_progress" | "planned" | "completed";
    type?: "movie" | "series" | "anime" | "book" | "manga" | null;
    page?: number;
    locale?: "es" | "en";
  } = {},
) =>
  getProfileSectionPage(
    db,
    ownerId,
    query.profile ?? "public",
    query.relationship ?? "stranger",
    {
      status: query.status ?? "completed",
      type: query.type ?? null,
      page: query.page ?? 1,
      locale: query.locale ?? "es",
    },
  );

// Written by hand on purpose, and not computed with `canView`: this is what each person must see.
const expected: [Level, Relationship, Level[]][] = [
  ["public", "owner", ["public", "friends", "private"]],
  ["public", "friend", ["public", "friends"]],
  ["public", "follower", ["public"]],
  ["public", "stranger", ["public"]],
  ["public", "signed_out", ["public"]],
  ["public", "blocked", []],
  ["friends", "owner", ["public", "friends", "private"]],
  ["friends", "friend", ["public", "friends"]],
  ["friends", "follower", []],
  ["friends", "stranger", []],
  ["friends", "signed_out", []],
  ["friends", "blocked", []],
  ["private", "owner", ["public", "friends", "private"]],
  ["private", "friend", []],
  ["private", "follower", []],
  ["private", "stranger", []],
  ["private", "signed_out", []],
  ["private", "blocked", []],
];

describe("getProfileSectionPage (SAG-127): who sees what", () => {
  it.each(expected)(
    "a %s profile: %s sees entries of the levels %j",
    async (profile, relationship, levels) => {
      const owner = await newUser();
      for (const visibility of ["public", "friends", "private"] as const) {
        await entry(owner.id, { visibility, title: `A ${visibility} entry` });
      }

      const page = await ask(owner.id, { profile, relationship });

      expect(page.entries.map((e) => e.title).sort()).toEqual(
        levels.map((level) => `A ${level} entry`).sort(),
      );
      // The counts hold only what the viewer may see, so they cannot tell that more exists.
      expect(page.counts.all).toBe(levels.length);
      expect(page.counts.movie).toBe(levels.length);
    },
  );

  it("never gives the notes of an entry, however public the entry is", async () => {
    const owner = await newUser();
    await entry(owner.id, { notes: "a private note" });

    const page = await ask(owner.id, { relationship: "owner" });

    expect(page.entries).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("a private note");
  });

  it("reads only the entries of the owner, and only of the section asked for", async () => {
    const owner = await newUser();
    const other = await newUser();
    await entry(owner.id, { title: "Mine" });
    await entry(owner.id, { title: "Planned", status: "planned" });
    await entry(owner.id, { title: "Paused", status: "paused" });
    await entry(other.id, { title: "Someone else's" });

    const page = await ask(owner.id);

    expect(page.entries.map((e) => e.title)).toEqual(["Mine"]);
    expect(page.counts.all).toBe(1);
  });
});

describe("getProfileSectionPage (SAG-127): pages, order and tabs", () => {
  it("goes page by page, the newest changed first, without losing or repeating a title", async () => {
    const owner = await newUser();
    const total = entriesPerPage + 2;
    for (let i = 0; i < total; i++) {
      await entry(owner.id, {
        title: `Number ${i}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1 + i)),
      });
    }

    const first = await ask(owner.id);
    const second = await ask(owner.id, { page: 2 });

    expect(first.entries).toHaveLength(entriesPerPage);
    expect(first.hasMore).toBe(true);
    expect(first.entries[0]?.title).toBe(`Number ${total - 1}`);
    expect(second.entries.map((e) => e.title)).toEqual([
      "Number 1",
      "Number 0",
    ]);
    expect(second.hasMore).toBe(false);
    expect(second.counts.all).toBe(total);
  });

  it("says there is no next page when the titles fit exactly", async () => {
    const owner = await newUser();
    for (let i = 0; i < entriesPerPage; i++) await entry(owner.id);

    const page = await ask(owner.id);

    expect(page.entries).toHaveLength(entriesPerPage);
    expect(page.hasMore).toBe(false);
  });

  it("filters by type, and the tabs still count every type", async () => {
    const owner = await newUser();
    await entry(owner.id, { title: "A movie", type: "movie" });
    await entry(owner.id, { title: "A book", type: "book" });
    await entry(owner.id, { title: "Another book", type: "book" });
    await entry(owner.id, { title: "My own", type: "custom" });

    // The owner looks: a custom title is shown to nobody else (SAG-196).
    const page = await ask(owner.id, { type: "book", relationship: "owner" });

    expect(page.entries.map((e) => e.title).sort()).toEqual([
      "A book",
      "Another book",
    ]);
    expect(page.counts).toEqual({
      all: 4,
      anime: 0,
      movie: 1,
      series: 0,
      book: 2,
      manga: 0,
    });
  });

  it("a title with no tab of its own is under all", async () => {
    const owner = await newUser();
    await entry(owner.id, { title: "My own", type: "custom" });

    const page = await ask(owner.id, { relationship: "owner" });

    expect(page.entries.map((e) => e.title)).toEqual(["My own"]);
  });

  it("answers an empty page past the end, and never reads past the last page", async () => {
    const owner = await newUser();
    await entry(owner.id);

    const past = await ask(owner.id, { page: 2 });
    const far = await ask(owner.id, { page: maxSectionPage * 1000 });

    expect(past.entries).toEqual([]);
    expect(past.hasMore).toBe(false);
    expect(past.counts.all).toBe(1);
    expect(far.entries).toEqual([]);
  });

  it("is empty with no entries", async () => {
    const owner = await newUser();

    const page = await ask(owner.id);

    expect(page.entries).toEqual([]);
    expect(page.counts.all).toBe(0);
  });

  it("gives the fields a poster needs, and the title in the language of the viewer", async () => {
    const owner = await newUser();
    const media = await entry(owner.id, {
      title: "Original",
      titles: { es: "En español", en: "In English" },
      score: 8,
    });

    const es = await ask(owner.id, { locale: "es" });
    const en = await ask(owner.id, { locale: "en" });

    expect(es.entries[0]).toEqual({
      mediaId: media.id,
      title: "En español",
      type: "movie",
      year: null,
      imageUrl: null,
      score: 8,
    });
    expect(en.entries[0]?.title).toBe("In English");
  });
});
