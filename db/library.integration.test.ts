import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addEntry,
  getEntry,
  getSeasonCounts,
  listEntries,
  removeEntry,
  saveEntry,
  totalEpisodes,
} from "../server/db/library";
import { saveMedia, saveParts } from "../server/db/media-store";
import { libraryEntries, mediaItems } from "../server/db/schema";
import type { EntryState } from "../server/library/rules";
import { libraryQuerySchema } from "../server/library/schema";
import type { NormalizedMedia } from "../server/providers/types";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

let counter = 0;
async function addMedia(
  title: string,
  overrides: Partial<NormalizedMedia> = {},
): Promise<string> {
  counter += 1;
  return saveMedia(db, {
    type: "anime",
    title,
    originalTitle: null,
    year: 2013,
    synopsis: {},
    imageUrl: null,
    status: "finished",
    popularity: 1,
    externalId: { provider: "tmdb", id: `tv/${counter}` },
    ...overrides,
  });
}

/** A series with two seasons of 2 and 1 episodes, and a special that does not count. */
async function addSeries(
  title: string,
  overrides: Partial<NormalizedMedia> = {},
) {
  const id = await addMedia(title, overrides);
  await saveParts(db, id, [
    { kind: "season", number: 0, title: "Especiales", airDate: null },
    { kind: "season", number: 1, title: "T1", airDate: null },
    { kind: "season", number: 2, title: "T2", airDate: null },
    {
      kind: "episode",
      number: 1,
      title: "Resumen",
      airDate: null,
      seasonNumber: 0,
    },
    { kind: "episode", number: 1, title: "a", airDate: null, seasonNumber: 1 },
    { kind: "episode", number: 2, title: "b", airDate: null, seasonNumber: 1 },
    { kind: "episode", number: 1, title: "c", airDate: null, seasonNumber: 2 },
  ]);
  return id;
}

const completed: EntryState = {
  status: "completed",
  progress: 3,
  score: 9,
  startedAt: "2026-01-01",
  finishedAt: "2026-02-01",
  rewatchCount: 1,
  notes: "Muy buena",
  visibility: "public",
};

describe("addEntry", () => {
  it("adds a title as planned and private, and a second add changes nothing", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");

    expect(await addEntry(db, ana.id, mediaId)).toBe(true);
    await saveEntry(db, ana.id, mediaId, completed);
    expect(await addEntry(db, ana.id, mediaId)).toBe(true);

    const entry = await getEntry(db, ana.id, mediaId);
    expect(entry).toMatchObject({ status: "completed", score: 9 });
    expect(await db.select().from(libraryEntries)).toHaveLength(1);
  });

  it("starts with the defaults of the table", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");

    await addEntry(db, ana.id, mediaId);

    expect(await getEntry(db, ana.id, mediaId)).toMatchObject({
      mediaId,
      title: "Ataque a los Titanes",
      status: "planned",
      progress: 0,
      score: null,
      startedAt: null,
      finishedAt: null,
      rewatchCount: 0,
      notes: null,
      visibility: "private",
    });
  });

  it("does not add a title that does not exist", async () => {
    const ana = await newUser();

    expect(
      await addEntry(db, ana.id, "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    ).toBe(false);
    expect(await db.select().from(libraryEntries)).toHaveLength(0);
  });

  it("does not add a title that somebody made for themselves", async () => {
    const ana = await newUser();
    const [custom] = await db
      .insert(mediaItems)
      .values({ type: "custom", title: "Mi historia" })
      .returning();

    expect(await addEntry(db, ana.id, custom?.id ?? "")).toBe(false);
    expect(await db.select().from(libraryEntries)).toHaveLength(0);
  });
});

describe("saveEntry, getEntry and removeEntry", () => {
  it("writes every field and reads it back", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);

    expect(await saveEntry(db, ana.id, mediaId, completed)).toBe(true);

    expect(await getEntry(db, ana.id, mediaId)).toMatchObject(completed);
  });

  it("never lets a person read, change or remove the entry of somebody else", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);
    await saveEntry(db, ana.id, mediaId, completed);

    // Beto knows the title id, and that is all he has.
    expect(await getEntry(db, beto.id, mediaId)).toBeNull();
    expect(
      await saveEntry(db, beto.id, mediaId, {
        ...completed,
        score: 1,
        notes: "x",
      }),
    ).toBe(false);
    expect(await removeEntry(db, beto.id, mediaId)).toBe(false);

    expect(await getEntry(db, ana.id, mediaId)).toMatchObject(completed);
  });

  it("gives each person their own entry for the same title", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);
    await addEntry(db, beto.id, mediaId);

    await saveEntry(db, ana.id, mediaId, completed);

    expect(await getEntry(db, beto.id, mediaId)).toMatchObject({
      status: "planned",
      score: null,
    });
  });

  it("removes only the entry, not the title", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);

    expect(await removeEntry(db, ana.id, mediaId)).toBe(true);
    expect(await removeEntry(db, ana.id, mediaId)).toBe(false);

    expect(await getEntry(db, ana.id, mediaId)).toBeNull();
    expect(await db.select().from(mediaItems)).toHaveLength(1);
  });

  it("answers false when the person has no entry to save", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");

    expect(await saveEntry(db, ana.id, mediaId, completed)).toBe(false);
  });

  it("has the database refuse what the rules would have refused", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);

    await expect(
      saveEntry(db, ana.id, mediaId, {
        ...completed,
        finishedAt: "2025-01-01",
      }),
    ).rejects.toThrow();
    await expect(
      saveEntry(db, ana.id, mediaId, { ...completed, score: 11 }),
    ).rejects.toThrow();
  });
});

describe("getSeasonCounts and totalEpisodes", () => {
  it("counts the episodes of each season and leaves the specials out", async () => {
    const mediaId = await addSeries("Una serie");

    const seasons = await getSeasonCounts(db, mediaId);

    expect(seasons).toEqual([
      { number: 1, episodes: 2 },
      { number: 2, episodes: 1 },
    ]);
    expect(totalEpisodes(seasons)).toBe(3);
  });

  it("gives nothing for a title with no seasons", async () => {
    const mediaId = await addMedia("Una película", { type: "movie" });

    expect(await getSeasonCounts(db, mediaId)).toEqual([]);
  });
});

describe("listEntries", () => {
  const query = (params: Record<string, string> = {}) =>
    libraryQuerySchema.parse(params);

  async function fill() {
    const ana = await newUser();
    const titan = await addSeries("Ataque a los Titanes", { year: 2013 });
    const matrix = await addMedia("Matrix", { type: "movie", year: 1999 });
    const bleach = await addMedia("Bleach", { year: 2004 });
    for (const id of [titan, matrix, bleach]) await addEntry(db, ana.id, id);
    await saveEntry(db, ana.id, titan, {
      ...completed,
      status: "in_progress",
      progress: 2,
      score: 8,
    });
    await saveEntry(db, ana.id, matrix, {
      ...completed,
      status: "completed",
      score: 10,
    });
    return { ana, titan, matrix, bleach };
  }

  it("lists the entries of the person with the episodes seen and the total", async () => {
    const { ana, titan } = await fill();

    const { rows, total } = await listEntries(
      db,
      ana.id,
      query({ sort: "title" }),
    );

    expect(total).toBe(3);
    expect(rows.map((row) => row.title)).toEqual([
      "Ataque a los Titanes",
      "Bleach",
      "Matrix",
    ]);
    expect(rows[0]).toMatchObject({
      mediaId: titan,
      status: "in_progress",
      progress: 2,
      totalEpisodes: 3,
      score: 8,
    });
    expect(rows[2]?.totalEpisodes).toBe(0);
  });

  it("never lists the entries of somebody else", async () => {
    const { bleach } = await fill();
    const beto = await newUser();
    await addEntry(db, beto.id, bleach);

    const { rows, total } = await listEntries(db, beto.id, query());

    expect(total).toBe(1);
    expect(rows.map((row) => row.title)).toEqual(["Bleach"]);
  });

  it("filters by type, status, year and minimum score", async () => {
    const { ana } = await fill();
    const titles = async (params: Record<string, string>) =>
      (
        await listEntries(db, ana.id, query({ sort: "title", ...params }))
      ).rows.map((row) => row.title);

    expect(await titles({ type: "movie" })).toEqual(["Matrix"]);
    expect(await titles({ status: "planned" })).toEqual(["Bleach"]);
    expect(await titles({ year: "2013" })).toEqual(["Ataque a los Titanes"]);
    expect(await titles({ score: "9" })).toEqual(["Matrix"]);
    expect(await titles({ score: "8" })).toEqual([
      "Ataque a los Titanes",
      "Matrix",
    ]);
    expect(await titles({ type: "anime", status: "completed" })).toEqual([]);
  });

  it("sorts by score and by year, with the ones without a value last", async () => {
    const { ana } = await fill();
    const titles = async (sort: string) =>
      (await listEntries(db, ana.id, query({ sort }))).rows.map(
        (row) => row.title,
      );

    expect(await titles("score")).toEqual([
      "Matrix",
      "Ataque a los Titanes",
      "Bleach",
    ]);
    expect(await titles("year")).toEqual([
      "Ataque a los Titanes",
      "Bleach",
      "Matrix",
    ]);
  });

  it("sorts by the most recently changed by default", async () => {
    const { ana, bleach } = await fill();
    // The writes of `fill` can land in the same millisecond, so the order is set by hand.
    await db.execute(
      sql`UPDATE library_entries SET updated_at = now() - interval '1 day'`,
    );
    await saveEntry(db, ana.id, bleach, { ...completed, score: 5 });

    const { rows } = await listEntries(db, ana.id, query());

    expect(rows[0]?.title).toBe("Bleach");
  });

  it("pages the answer and counts every match", async () => {
    const ana = await newUser();
    for (let index = 1; index <= 30; index += 1) {
      await addEntry(
        db,
        ana.id,
        await addMedia(`Titulo ${String(index).padStart(2, "0")}`),
      );
    }

    const first = await listEntries(db, ana.id, query({ sort: "title" }));
    const second = await listEntries(
      db,
      ana.id,
      query({ sort: "title", page: "2" }),
    );

    expect(first.total).toBe(30);
    expect(first.rows).toHaveLength(24);
    expect(second.rows).toHaveLength(6);
    expect(second.rows[0]?.title).toBe("Titulo 25");
  });
});
