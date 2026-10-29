import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addEntry,
  getEntry,
  getSeasonCounts,
  listLibrary,
  removeEntry,
  saveEntry,
  totalEpisodes,
  type Library,
} from "../server/db/library";
import { exportAccount } from "../server/account/export";
import { saveMedia, saveParts } from "../server/db/media-store";
import { libraryEntries, mediaItems } from "../server/db/schema";
import type { EntryState } from "../server/library/rules";
import { libraryQuerySchema, pageSize } from "../server/library/schema";
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
  progressUnit: null,
  progressTotal: null,
  score: 9,
  startedAt: "2026-01-01",
  finishedAt: "2026-02-01",
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

    const entry = await getEntry(db, ana.id, mediaId, "es");
    expect(entry).toMatchObject({ status: "completed", score: 9 });
    expect(await db.select().from(libraryEntries)).toHaveLength(1);
  });

  it("starts with the defaults of the table", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");

    await addEntry(db, ana.id, mediaId);

    expect(await getEntry(db, ana.id, mediaId, "es")).toMatchObject({
      mediaId,
      title: "Ataque a los Titanes",
      status: "planned",
      progress: 0,
      progressUnit: null,
      progressTotal: null,
      score: null,
      startedAt: null,
      finishedAt: null,
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

    expect(await getEntry(db, ana.id, mediaId, "es")).toMatchObject(completed);
  });

  it("never lets a person read, change or remove the entry of somebody else", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);
    await saveEntry(db, ana.id, mediaId, completed);

    // Beto knows the title id, and that is all he has.
    expect(await getEntry(db, beto.id, mediaId, "es")).toBeNull();
    expect(
      await saveEntry(db, beto.id, mediaId, {
        ...completed,
        score: 1,
        notes: "x",
      }),
    ).toBe(false);
    expect(await removeEntry(db, beto.id, mediaId)).toBe(false);

    expect(await getEntry(db, ana.id, mediaId, "es")).toMatchObject(completed);
  });

  it("gives each person their own entry for the same title", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);
    await addEntry(db, beto.id, mediaId);

    await saveEntry(db, ana.id, mediaId, completed);

    expect(await getEntry(db, beto.id, mediaId, "es")).toMatchObject({
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

    expect(await getEntry(db, ana.id, mediaId, "es")).toBeNull();
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

describe("the progress of a book or a manga", () => {
  const reading: EntryState = {
    ...completed,
    status: "in_progress",
    progress: 120,
    progressUnit: "pages",
    progressTotal: 320,
    finishedAt: null,
  };

  it("writes the unit and the total and reads them back", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Dune", { type: "book" });
    await addEntry(db, ana.id, mediaId);

    await saveEntry(db, ana.id, mediaId, reading);

    expect(await getEntry(db, ana.id, mediaId, "es")).toMatchObject({
      progress: 120,
      progressUnit: "pages",
      progressTotal: 320,
    });
  });

  it("has the database refuse a total below the progress, or a total with no unit", async () => {
    const ana = await newUser();
    const mediaId = await addMedia("Dune", { type: "book" });
    await addEntry(db, ana.id, mediaId);

    await expect(
      saveEntry(db, ana.id, mediaId, { ...reading, progressTotal: 100 }),
    ).rejects.toThrow();
    await expect(
      saveEntry(db, ana.id, mediaId, { ...reading, progressUnit: null }),
    ).rejects.toThrow();
  });

  it("comes with each row of the library, and with the export", async () => {
    const ana = await newUser();
    const book = await addMedia("Dune", { type: "book" });
    const manga = await addMedia("Berserk", { type: "manga" });
    await addEntry(db, ana.id, book);
    await addEntry(db, ana.id, manga);
    await saveEntry(db, ana.id, book, reading);
    await saveEntry(db, ana.id, manga, {
      ...reading,
      progress: 3,
      progressUnit: "volumes",
      progressTotal: null,
    });

    const rows = flat(
      await listLibrary(db, ana.id, query({ sort: "title" }), "es"),
    );
    const exported = await exportAccount(db, ana.id);

    expect(rows).toEqual([
      expect.objectContaining({
        title: "Berserk",
        progress: 3,
        progressUnit: "volumes",
        progressTotal: null,
        totalEpisodes: 0,
      }),
      expect.objectContaining({
        title: "Dune",
        progress: 120,
        progressUnit: "pages",
        progressTotal: 320,
      }),
    ]);
    expect(exported?.libraryEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Dune",
          progressUnit: "pages",
          progressTotal: 320,
        }),
      ]),
    );
  });
});

describe("the data export", () => {
  it("has the library of the person and nothing of anybody else", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const mediaId = await addMedia("Ataque a los Titanes");
    await addEntry(db, ana.id, mediaId);
    await saveEntry(db, ana.id, mediaId, completed);
    await addEntry(db, beto.id, mediaId);

    const anaData = await exportAccount(db, ana.id);
    const betoData = await exportAccount(db, beto.id);

    expect(anaData?.libraryEntries).toEqual([
      expect.objectContaining({
        title: "Ataque a los Titanes",
        status: "completed",
        score: 9,
        notes: "Muy buena",
        visibility: "public",
      }),
    ]);
    expect(betoData?.libraryEntries).toEqual([
      expect.objectContaining({ status: "planned", score: null, notes: null }),
    ]);
    // Never the id of the account or of the title.
    expect(JSON.stringify(anaData)).not.toContain(ana.id);
    expect(JSON.stringify(anaData)).not.toContain(mediaId);
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

const query = (params: Record<string, string> = {}) =>
  libraryQuerySchema.parse(params);

/** Every row of every section, in the order of the sections. */
const flat = (library: Library) =>
  library.sections.flatMap((section) => section.rows);

describe("listLibrary", () => {
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
      progressUnit: null,
      progressTotal: null,
      score: 8,
    });
    await saveEntry(db, ana.id, matrix, {
      ...completed,
      status: "completed",
      score: 10,
    });
    return { ana, titan, matrix, bleach };
  }

  const titles = async (
    userId: string,
    params: Record<string, string>,
    locale: "es" | "en" = "es",
  ) =>
    flat(
      await listLibrary(
        db,
        userId,
        query({ sort: "title", ...params }),
        locale,
      ),
    ).map((row) => row.title);

  it("groups the entries by status in the order they are shown, empty sections included", async () => {
    const { ana, titan } = await fill();

    const library = await listLibrary(db, ana.id, query(), "es");

    expect(
      library.sections.map((section) => [
        section.status,
        section.total,
        section.rows.map((row) => row.title),
      ]),
    ).toEqual([
      ["in_progress", 1, ["Ataque a los Titanes"]],
      ["planned", 1, ["Bleach"]],
      ["paused", 0, []],
      ["dropped", 0, []],
      ["completed", 1, ["Matrix"]],
    ]);
    expect(library.sections[0]?.rows[0]).toMatchObject({
      mediaId: titan,
      status: "in_progress",
      progress: 2,
      totalEpisodes: 3,
      score: 8,
      timesWatched: 0,
    });
    // Only the completed title counts as watched once.
    expect(library.sections[4]?.rows[0]).toMatchObject({
      totalEpisodes: 0,
      timesWatched: 1,
    });
  });

  it("counts the entries of every tab", async () => {
    const { ana } = await fill();

    expect((await listLibrary(db, ana.id, query(), "es")).counts).toEqual({
      all: 3,
      anime: 2,
      movie: 1,
      series: 0,
      book: 0,
      manga: 0,
    });
  });

  it("answers for a person with nothing", async () => {
    const ana = await newUser();

    const library = await listLibrary(db, ana.id, query(), "es");

    expect(library.counts.all).toBe(0);
    expect(library.sections.map((section) => section.total)).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect(flat(library)).toEqual([]);
  });

  it("never lists or counts the entries of somebody else", async () => {
    const { bleach } = await fill();
    const beto = await newUser();
    await addEntry(db, beto.id, bleach);

    const library = await listLibrary(db, beto.id, query(), "es");

    expect(library.counts.all).toBe(1);
    expect(flat(library).map((row) => row.title)).toEqual(["Bleach"]);
  });

  it("narrows the sections to the tab, and leaves the count of every tab as it is", async () => {
    const { ana } = await fill();

    const library = await listLibrary(
      db,
      ana.id,
      query({ type: "movie" }),
      "es",
    );

    expect(flat(library).map((row) => row.title)).toEqual(["Matrix"]);
    expect(library.sections.map((section) => section.total)).toEqual([
      0, 0, 0, 0, 1,
    ]);
    expect(library.counts).toMatchObject({ all: 3, anime: 2, movie: 1 });
  });

  it("filters by year and minimum score, and the tabs count only what matches", async () => {
    const { ana } = await fill();

    expect(await titles(ana.id, { year: "2013" })).toEqual([
      "Ataque a los Titanes",
    ]);
    expect(await titles(ana.id, { score: "9" })).toEqual(["Matrix"]);
    expect(await titles(ana.id, { score: "8" })).toEqual([
      "Ataque a los Titanes",
      "Matrix",
    ]);
    expect(await titles(ana.id, { type: "anime", score: "9" })).toEqual([]);
    expect(
      (await listLibrary(db, ana.id, query({ score: "8" }), "es")).counts,
    ).toMatchObject({ all: 2, anime: 1, movie: 1 });
  });

  describe("the search", () => {
    async function fillForSearch() {
      const ana = await newUser();
      const ids = {
        sky: await addMedia("El castillo en el cielo", {
          originalTitle: "Tenkū no Shiro Rapyuta",
        }),
        mon: await addMedia("Pokémon"),
        rate: await addMedia("Éxito al 100% de nota_buena"),
        other: await addMedia("Otro"),
      };
      await db.execute(
        sql`UPDATE media_items SET titles = '{"es":"El castillo en el cielo","en":"Castle in the Sky"}' WHERE id = ${ids.sky}`,
      );
      for (const id of Object.values(ids)) await addEntry(db, ana.id, id);
      return ana;
    }

    it("matches part of a title, ignoring case and accents", async () => {
      const ana = await fillForSearch();

      expect(await titles(ana.id, { q: "POKEMON" })).toEqual(["Pokémon"]);
      expect(await titles(ana.id, { q: "poké" })).toEqual(["Pokémon"]);
      expect(await titles(ana.id, { q: "castillo en" })).toEqual([
        "El castillo en el cielo",
      ]);
      expect(await titles(ana.id, { q: "nada así" })).toEqual([]);
    });

    it("also finds a title by its original title and by its name in another language", async () => {
      const ana = await fillForSearch();

      expect(await titles(ana.id, { q: "rapyuta" })).toEqual([
        "El castillo en el cielo",
      ]);
      expect(await titles(ana.id, { q: "castle in" })).toEqual([
        "El castillo en el cielo",
      ]);
      // In English the title shown is the English one.
      expect(await titles(ana.id, { q: "castillo" }, "en")).toEqual([
        "Castle in the Sky",
      ]);
    });

    it("takes % and _ as plain characters, not as wildcards", async () => {
      const ana = await fillForSearch();

      expect(await titles(ana.id, { q: "100%" })).toEqual([
        "Éxito al 100% de nota_buena",
      ]);
      expect(await titles(ana.id, { q: "%" })).toEqual([
        "Éxito al 100% de nota_buena",
      ]);
      expect(await titles(ana.id, { q: "nota_b" })).toEqual([
        "Éxito al 100% de nota_buena",
      ]);
      expect(await titles(ana.id, { q: "nota_" })).toEqual([
        "Éxito al 100% de nota_buena",
      ]);
      expect(await titles(ana.id, { q: "o_a" })).toEqual([]);
      expect(await titles(ana.id, { q: "\\" })).toEqual([]);
    });

    it("counts the tabs by what matches the search", async () => {
      const ana = await fillForSearch();
      const movie = await addMedia("Pokémon la película", { type: "movie" });
      await addEntry(db, ana.id, movie);

      const library = await listLibrary(
        db,
        ana.id,
        query({ q: "pokemon" }),
        "es",
      );

      expect(library.counts).toMatchObject({ all: 2, anime: 1, movie: 1 });
    });
  });

  describe("the visibility filter", () => {
    async function fillVisibility() {
      const ana = await newUser();
      const ids: Record<string, string> = {};
      for (const [title, visibility, status, type] of [
        ["Pública anime", "public", "in_progress", "anime"],
        ["Pública peli", "public", "completed", "movie"],
        ["Amigos anime", "friends", "completed", "anime"],
        ["Privada anime", "private", "planned", "anime"],
        ["Privada peli", "private", "completed", "movie"],
      ] as const) {
        const id = await addMedia(title, { type });
        ids[title] = id;
        await addEntry(db, ana.id, id);
        await saveEntry(db, ana.id, id, { ...completed, status, visibility });
      }
      return { ana, ids };
    }

    it("keeps one level at a time, and shows the level of each row", async () => {
      const { ana } = await fillVisibility();

      expect(await titles(ana.id, { visibility: "public" })).toEqual([
        "Pública anime",
        "Pública peli",
      ]);
      expect(await titles(ana.id, { visibility: "friends" })).toEqual([
        "Amigos anime",
      ]);
      expect(await titles(ana.id, { visibility: "private" })).toEqual([
        "Privada anime",
        "Privada peli",
      ]);
      const all = flat(await listLibrary(db, ana.id, query(), "es"));
      expect(
        Object.fromEntries(all.map((row) => [row.title, row.visibility])),
      ).toEqual({
        "Pública anime": "public",
        "Pública peli": "public",
        "Amigos anime": "friends",
        "Privada anime": "private",
        "Privada peli": "private",
      });
    });

    it("works with a tab and with the search, and the counts of the tabs follow it", async () => {
      const { ana } = await fillVisibility();

      expect(
        await titles(ana.id, { visibility: "public", type: "movie" }),
      ).toEqual(["Pública peli"]);
      expect(
        await titles(ana.id, { visibility: "private", q: "peli" }),
      ).toEqual(["Privada peli"]);
      const library = await listLibrary(
        db,
        ana.id,
        query({ visibility: "public" }),
        "es",
      );
      expect(library.counts).toMatchObject({ all: 2, anime: 1, movie: 1 });
      expect(library.sections.map((section) => section.total)).toEqual([
        1, 0, 0, 0, 1,
      ]);
    });

    it("gives the same totals and rows, so the numbers agree", async () => {
      const { ana } = await fillVisibility();

      for (const visibility of ["public", "friends", "private"]) {
        const library = await listLibrary(
          db,
          ana.id,
          query({ visibility }),
          "es",
        );
        const rows = flat(library).length;
        expect(rows).toBe(library.counts.all);
        expect(library.sections.reduce((sum, s) => sum + s.total, 0)).toBe(
          rows,
        );
      }
    });

    it("never shows the entries of another person, whatever their level", async () => {
      const { ids } = await fillVisibility();
      const beto = await newUser();
      const shared = ids["Pública anime"] as string;
      await addEntry(db, beto.id, shared);
      await saveEntry(db, beto.id, shared, {
        ...completed,
        visibility: "private",
      });

      expect(await titles(beto.id, { visibility: "public" })).toEqual([]);
      expect(await titles(beto.id, { visibility: "private" })).toEqual([
        "Pública anime",
      ]);
    });
  });

  describe("the notes", () => {
    it("come with each row, whole, and are empty when the person wrote none", async () => {
      const ana = await newUser();
      const withNote = await addMedia("Con nota");
      const without = await addMedia("Sin nota");
      const longest = "ñ".repeat(2000);
      await addEntry(db, ana.id, withNote);
      await addEntry(db, ana.id, without);
      await saveEntry(db, ana.id, withNote, { ...completed, notes: longest });
      await saveEntry(db, ana.id, without, { ...completed, notes: null });

      const rows = flat(await listLibrary(db, ana.id, query(), "es"));

      expect(rows.find((row) => row.title === "Con nota")?.notes).toBe(longest);
      expect(rows.find((row) => row.title === "Sin nota")?.notes).toBeNull();
    });

    it("never come from the entry of another person", async () => {
      const ana = await newUser();
      const beto = await newUser();
      const shared = await addMedia("Compartido");
      await addEntry(db, ana.id, shared);
      await addEntry(db, beto.id, shared);
      await saveEntry(db, ana.id, shared, { ...completed, notes: "de Ana" });
      await saveEntry(db, beto.id, shared, { ...completed, notes: "de Beto" });

      const rows = flat(await listLibrary(db, beto.id, query(), "es"));

      expect(rows.map((row) => row.notes)).toEqual(["de Beto"]);
    });
  });

  it("sorts by score, by year and by title inside each section, the ones without a value last", async () => {
    const ana = await newUser();
    const rows = [
      { title: "Bravo", year: 2000, score: 5 },
      { title: "Alfa", year: 2020, score: null },
      { title: "Charlie", year: null, score: 9 },
    ];
    for (const row of rows) {
      const id = await addMedia(row.title, { year: row.year });
      await addEntry(db, ana.id, id);
      await saveEntry(db, ana.id, id, { ...completed, score: row.score });
    }

    expect(await titles(ana.id, { sort: "score" })).toEqual([
      "Charlie",
      "Bravo",
      "Alfa",
    ]);
    expect(await titles(ana.id, { sort: "year" })).toEqual([
      "Alfa",
      "Bravo",
      "Charlie",
    ]);
    expect(await titles(ana.id, { sort: "title" })).toEqual([
      "Alfa",
      "Bravo",
      "Charlie",
    ]);
  });

  it("keeps the sections in their order whatever the sort", async () => {
    const { ana } = await fill();

    for (const sort of ["recent", "title", "score", "year"]) {
      const library = await listLibrary(db, ana.id, query({ sort }), "es");
      expect(library.sections.map((section) => section.status)).toEqual([
        "in_progress",
        "planned",
        "paused",
        "dropped",
        "completed",
      ]);
    }
  });

  it("sorts by the most recently changed by default", async () => {
    const ana = await newUser();
    const first = await addMedia("Primero");
    const second = await addMedia("Segundo");
    await addEntry(db, ana.id, first);
    await addEntry(db, ana.id, second);
    // The writes above can land in the same millisecond, so the order is set by hand.
    await db.execute(
      sql`UPDATE library_entries SET updated_at = now() - interval '1 day'`,
    );
    await saveEntry(db, ana.id, second, { ...completed, status: "planned" });

    const library = await listLibrary(db, ana.id, query(), "es");

    expect(library.sections[1]?.rows.map((row) => row.title)).toEqual([
      "Segundo",
      "Primero",
    ]);
  });

  describe("the pages of a section", () => {
    async function fillMany() {
      const ana = await newUser();
      for (let index = 1; index <= 30; index += 1) {
        const id = await addMedia(`Titulo ${String(index).padStart(2, "0")}`);
        await addEntry(db, ana.id, id);
        await saveEntry(db, ana.id, id, { ...completed, status: "completed" });
      }
      for (let index = 1; index <= 14; index += 1) {
        await addEntry(
          db,
          ana.id,
          await addMedia(`Pendiente ${String(index).padStart(2, "0")}`),
        );
      }
      return ana;
    }

    it("takes a page of each section and counts every match", async () => {
      const ana = await fillMany();

      const library = await listLibrary(
        db,
        ana.id,
        query({ sort: "title" }),
        "es",
      );

      const completedSection = library.sections[4];
      expect(completedSection).toMatchObject({
        status: "completed",
        total: 30,
        page: 1,
        pages: 3,
      });
      expect(completedSection?.rows).toHaveLength(pageSize);
      expect(library.sections[1]).toMatchObject({ total: 14, pages: 2 });
      expect(library.sections[1]?.rows).toHaveLength(pageSize);
    });

    it("moves one section to another page and leaves the rest", async () => {
      const ana = await fillMany();

      const library = await listLibrary(
        db,
        ana.id,
        query({ sort: "title", completed_page: "3" }),
        "es",
      );

      expect(library.sections[4]?.page).toBe(3);
      expect(library.sections[4]?.rows.map((row) => row.title)).toEqual([
        "Titulo 25",
        "Titulo 26",
        "Titulo 27",
        "Titulo 28",
        "Titulo 29",
        "Titulo 30",
      ]);
      expect(library.sections[1]?.page).toBe(1);
      expect(library.sections[1]?.rows[0]?.title).toBe("Pendiente 01");
    });

    it("shows the last page for a page that does not exist", async () => {
      const ana = await fillMany();

      const library = await listLibrary(
        db,
        ana.id,
        query({ sort: "title", completed_page: "9", planned_page: "9999" }),
        "es",
      );

      expect(library.sections[4]).toMatchObject({ page: 3 });
      expect(library.sections[4]?.rows).toHaveLength(6);
      expect(library.sections[1]).toMatchObject({ page: 2 });
      expect(library.sections[1]?.rows).toHaveLength(2);
    });

    it("does not repeat or lose an entry from one page to the next when they tie", async () => {
      const ana = await newUser();
      for (let index = 1; index <= 30; index += 1) {
        const id = await addMedia(`Igual ${index}`, { year: 2000 });
        await addEntry(db, ana.id, id);
        await saveEntry(db, ana.id, id, { ...completed, score: 7 });
      }

      const seen: string[] = [];
      for (const page of ["1", "2", "3"]) {
        const library = await listLibrary(
          db,
          ana.id,
          query({ sort: "score", completed_page: page }),
          "es",
        );
        seen.push(
          ...(library.sections[4]?.rows ?? []).map((row) => row.mediaId),
        );
      }

      expect(seen).toHaveLength(30);
      expect(new Set(seen).size).toBe(30);
    });
  });
});

describe("titles by language", () => {
  async function addBilingual() {
    const media = {
      type: "movie",
      title: "Interestelar",
      originalTitle: "Interstellar",
      year: 2014,
      synopsis: {},
      imageUrl: null,
      status: "finished",
      popularity: 1,
      externalId: { provider: "tmdb", id: "movie/157336" },
    } as const;
    const mediaId = await saveMedia(db, media, "es");
    await saveMedia(db, { ...media, title: "Interstellar" }, "en");
    return mediaId;
  }

  it("shows the entry and the list with the title of the language asked", async () => {
    const ana = await newUser();
    const mediaId = await addBilingual();
    await addEntry(db, ana.id, mediaId);

    expect((await getEntry(db, ana.id, mediaId, "es"))?.title).toBe(
      "Interestelar",
    );
    expect((await getEntry(db, ana.id, mediaId, "en"))?.title).toBe(
      "Interstellar",
    );
    const list = await listLibrary(db, ana.id, query(), "es");
    expect(flat(list).map((row) => row.title)).toEqual(["Interestelar"]);
  });

  it("sorts by the title of the language asked", async () => {
    const ana = await newUser();
    // In Spanish: "Alfa" < "Zeta"; in English the same two titles swap places.
    const first = await addMedia("Zeta");
    const second = await addMedia("Alfa");
    await db.execute(
      sql`UPDATE media_items SET titles = '{"es":"Zeta","en":"Alpha"}' WHERE id = ${first}`,
    );
    await db.execute(
      sql`UPDATE media_items SET titles = '{"es":"Alfa","en":"Zulu"}' WHERE id = ${second}`,
    );
    await addEntry(db, ana.id, first);
    await addEntry(db, ana.id, second);

    const titles = async (locale: "es" | "en") =>
      (
        await listLibrary(db, ana.id, query({ sort: "title" }), locale)
      ).sections.flatMap((section) => section.rows.map((row) => row.title));

    expect(await titles("es")).toEqual(["Alfa", "Zeta"]);
    expect(await titles("en")).toEqual(["Alpha", "Zulu"]);
  });

  it("puts the titles of every language in the data export", async () => {
    const ana = await newUser();
    const mediaId = await addBilingual();
    await addEntry(db, ana.id, mediaId);

    const data = await exportAccount(db, ana.id);

    expect(data?.libraryEntries[0]).toMatchObject({
      titles: { es: "Interestelar", en: "Interstellar" },
    });
  });
});
