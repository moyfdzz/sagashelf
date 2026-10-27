import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exportAccount } from "../server/account/export";
import { eraseAccount } from "../server/db/erase-user";
import { addEntry, getEntry, saveEntry } from "../server/db/library";
import { saveMedia, saveParts } from "../server/db/media-store";
import {
  libraryEntries,
  libraryViewings,
  mediaItems,
} from "../server/db/schema";
import { addViewing, listViewings } from "../server/db/viewings";
import { previewImport, runImport } from "../server/library/import";
import { maxNewTitles, parseImportFile } from "../server/library/import-file";
import type { EntryState } from "../server/library/rules";
import type { MediaProvider, NormalizedMedia } from "../server/providers/types";
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

const movie = (id: number, title = `Movie ${id}`): NormalizedMedia => ({
  type: "movie",
  title,
  originalTitle: null,
  year: 2014,
  synopsis: {},
  imageUrl: null,
  status: "finished",
  popularity: 1,
  externalId: { provider: "tmdb", id: `movie/${id}` },
});

const series = (id: number): NormalizedMedia => ({
  ...movie(id, `Series ${id}`),
  type: "series",
  externalId: { provider: "tmdb", id: `tv/${id}` },
});

/** A provider that knows these titles; the others are "not found". */
function provider(known: NormalizedMedia[] = []): MediaProvider {
  return {
    id: "tmdb",
    capabilities: { types: ["movie", "series"], parts: false, trending: false },
    attribution: {
      name: "TMDB",
      url: "https://www.themoviedb.org",
      notice: "",
    },
    search: vi.fn(),
    getById: vi.fn(
      async (externalId: string) =>
        known.find((item) => item.externalId.id === externalId) ?? null,
    ),
    getParts: vi.fn(async () => []),
  };
}

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  title: `Title ${id}`,
  source: { provider: "tmdb", id },
  status: "completed",
  progress: 0,
  score: 9,
  startedAt: "2026-01-01",
  finishedAt: "2026-01-02",
  notes: "Muy buena",
  viewings: [],
  ...overrides,
});

function fileOf(entries: unknown[]) {
  const result = parseImportFile(
    JSON.stringify({ schemaVersion: 1, libraryEntries: entries }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const run = (
  userId: string,
  entries: unknown[],
  options: {
    replace?: boolean;
    keepVisibility?: boolean;
    providers?: MediaProvider[];
  } = {},
) =>
  runImport(
    { db, providers: options.providers ?? [provider()] },
    userId,
    fileOf(entries),
    {
      replace: options.replace ?? false,
      keepVisibility: options.keepVisibility,
      locale: "es",
    },
  );

describe("importing titles we already hold", () => {
  it("adds the entries with their fields and viewings, private by default", async () => {
    const ana = await newUser();
    const media = await saveMedia(db, movie(1));

    const result = await run(ana.id, [
      {
        ...entry("movie/1"),
        visibility: "public",
        viewings: [
          { startedOn: "2025-05-01", finishedOn: "2025-05-03", notes: "Cine" },
        ],
      },
    ]);

    expect(result).toMatchObject({
      added: 1,
      replaced: 0,
      kept: 0,
      skipped: [],
    });
    expect(await getEntry(db, ana.id, media, "es")).toMatchObject({
      status: "completed",
      score: 9,
      startedAt: "2026-01-01",
      finishedAt: "2026-01-02",
      notes: "Muy buena",
      visibility: "private",
    });
    expect(await listViewings(db, ana.id, media)).toEqual([
      expect.objectContaining({
        startedOn: "2025-05-01",
        finishedOn: "2025-05-03",
        notes: "Cine",
      }),
    ]);
  });

  it("gives a new entry the visibility of the file only when the person keeps it", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const medias = await Promise.all(
      [1, 2, 3].map((n) => saveMedia(db, movie(n))),
    );
    const file = [
      entry("movie/1", { visibility: "public" }),
      entry("movie/2", { visibility: "friends" }),
      entry("movie/3", { visibility: "private" }),
    ];
    const visibilities = async (userId: string) =>
      Promise.all(
        medias.map(
          async (media) =>
            (await getEntry(db, userId, media, "es"))?.visibility,
        ),
      );

    await run(ana.id, file);
    await run(beto.id, file, { keepVisibility: true });

    expect(await visibilities(ana.id)).toEqual([
      "private",
      "private",
      "private",
    ]);
    expect(await visibilities(beto.id)).toEqual([
      "public",
      "friends",
      "private",
    ]);
  });

  it("never changes the visibility of an entry the person already has, even replacing it", async () => {
    const ana = await newUser();
    const media = await saveMedia(db, movie(1));
    await addEntry(db, ana.id, media);
    await saveEntry(db, ana.id, media, {
      status: "in_progress",
      progress: 0,
      score: 3,
      startedAt: null,
      finishedAt: null,
      notes: null,
      visibility: "private",
    } satisfies EntryState);

    const result = await run(
      ana.id,
      [entry("movie/1", { visibility: "public" })],
      { replace: true, keepVisibility: true },
    );

    expect(result).toMatchObject({ added: 0, replaced: 1 });
    expect(await getEntry(db, ana.id, media, "es")).toMatchObject({
      score: 9,
      visibility: "private",
    });
  });

  it("keeps an entry the person already has, unless they ask to replace it", async () => {
    const ana = await newUser();
    const media = await saveMedia(db, movie(1));
    await addEntry(db, ana.id, media);
    await saveEntry(db, ana.id, media, {
      status: "in_progress",
      progress: 0,
      score: 3,
      startedAt: "2026-03-01",
      finishedAt: null,
      notes: "mine",
      visibility: "friends",
    } satisfies EntryState);
    await addViewing(db, ana.id, media, {
      startedOn: null,
      finishedOn: "2020-01-01",
      notes: "old",
    });

    const kept = await run(ana.id, [entry("movie/1")]);
    expect(kept).toMatchObject({ added: 0, replaced: 0, kept: 1 });
    expect(await getEntry(db, ana.id, media, "es")).toMatchObject({
      score: 3,
      notes: "mine",
    });

    const replaced = await run(
      ana.id,
      [
        entry("movie/1", {
          viewings: [
            { startedOn: null, finishedOn: "2024-02-02", notes: null },
          ],
        }),
      ],
      { replace: true },
    );
    expect(replaced).toMatchObject({ added: 0, replaced: 1, kept: 0 });
    expect(await getEntry(db, ana.id, media, "es")).toMatchObject({
      status: "completed",
      score: 9,
      notes: "Muy buena",
      // An existing entry keeps the visibility its owner chose.
      visibility: "friends",
    });
    expect(await listViewings(db, ana.id, media)).toEqual([
      expect.objectContaining({ finishedOn: "2024-02-02" }),
    ]);
  });

  it("only touches the library of the person who imports", async () => {
    const ana = await newUser();
    const beto = await newUser();
    const media = await saveMedia(db, movie(1));
    await addEntry(db, beto.id, media);
    await saveEntry(db, beto.id, media, {
      status: "dropped",
      progress: 0,
      score: 2,
      startedAt: null,
      finishedAt: null,
      notes: "de Beto",
      visibility: "private",
    });

    await run(ana.id, [entry("movie/1")], { replace: true });

    expect(await getEntry(db, beto.id, media, "es")).toMatchObject({
      status: "dropped",
      notes: "de Beto",
    });
    expect(await db.select().from(libraryEntries)).toHaveLength(2);
  });

  it("caps the progress to the episodes of the title", async () => {
    const ana = await newUser();
    const media = await saveMedia(db, series(7));
    await saveParts(db, media, [
      { kind: "season", number: 1, title: null, airDate: null },
      {
        kind: "episode",
        number: 1,
        title: null,
        airDate: null,
        seasonNumber: 1,
      },
      {
        kind: "episode",
        number: 2,
        title: null,
        airDate: null,
        seasonNumber: 1,
      },
    ]);

    await run(ana.id, [
      entry("tv/7", { status: "in_progress", progress: 999, finishedAt: null }),
    ]);

    expect(await getEntry(db, ana.id, media, "es")).toMatchObject({
      status: "in_progress",
      progress: 2,
    });
  });

  it("never matches a title a person made for themselves", async () => {
    const ana = await newUser();
    await db.insert(mediaItems).values({ type: "custom", title: "Mine" });

    const result = await run(ana.id, [entry("movie/1")]);

    expect(result.added).toBe(0);
  });
});

describe("importing titles we do not hold yet", () => {
  it("asks the provider for them and saves them from what it answers, not from the file", async () => {
    const ana = await newUser();
    const tmdb = provider([movie(5, "Real title")]);

    const result = await run(
      ana.id,
      [entry("movie/5", { title: "Fake title" })],
      {
        providers: [tmdb],
      },
    );

    expect(result.added).toBe(1);
    expect(tmdb.getById).toHaveBeenCalledTimes(1);
    const saved = await db.select().from(mediaItems);
    expect(saved.map((item) => item.title)).toEqual(["Real title"]);
  });

  it("asks for at most the cap of new titles and lists the rest as pending", async () => {
    const ana = await newUser();
    const all = Array.from({ length: maxNewTitles + 3 }, (_, i) =>
      movie(i + 1),
    );
    const tmdb = provider(all);

    const result = await run(
      ana.id,
      all.map((item) => entry(item.externalId.id)),
      { providers: [tmdb] },
    );

    expect(tmdb.getById).toHaveBeenCalledTimes(maxNewTitles);
    expect(result.added).toBe(maxNewTitles);
    expect(
      result.skipped.filter((item) => item.reason === "pending"),
    ).toHaveLength(3);

    // A second import brings the next ones.
    const second = await run(
      ana.id,
      all.map((item) => entry(item.externalId.id)),
      { providers: [tmdb] },
    );
    expect(second.added).toBe(3);
    expect(second.kept).toBe(maxNewTitles);
  });

  it("lists a title the provider does not know, and one it could not answer for", async () => {
    const ana = await newUser();
    const tmdb = provider();
    vi.mocked(tmdb.getById).mockImplementation(async (id: string) => {
      if (id === "movie/2") throw new Error("down");
      return null;
    });

    const result = await run(ana.id, [entry("movie/1"), entry("movie/2")], {
      providers: [tmdb],
    });

    expect(result.added).toBe(0);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual([
      "not_found",
      "pending",
    ]);
  });

  it("skips a source that has no provider here, but still imports what it holds", async () => {
    const ana = await newUser();
    await saveMedia(db, movie(1));

    const result = await run(ana.id, [
      entry("movie/1"),
      { ...entry("x"), source: { provider: "mangadex", id: "abc" } },
    ]);

    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "unsupported_provider" }),
    ]);
  });
});

describe("the preview", () => {
  it("counts what would happen and writes nothing", async () => {
    const ana = await newUser();
    const have = await saveMedia(db, movie(1));
    await saveMedia(db, movie(2));
    await addEntry(db, ana.id, have);

    const preview = await previewImport(
      { db, providers: [provider()] },
      ana.id,
      fileOf([entry("movie/1"), entry("movie/2"), entry("movie/3")]),
    );

    expect(preview).toMatchObject({
      add: 1,
      exists: 1,
      fetch: 1,
      shared: { public: 0, friends: 0 },
      skipped: [],
    });
    expect(await db.select().from(libraryEntries)).toHaveLength(1);
  });

  it("counts the new titles the file marks as public or for friends, not the ones already owned", async () => {
    const ana = await newUser();
    const have = await saveMedia(db, movie(1));
    await saveMedia(db, movie(2));
    await addEntry(db, ana.id, have);

    const preview = await previewImport(
      { db, providers: [provider()] },
      ana.id,
      fileOf([
        entry("movie/1", { visibility: "public" }),
        entry("movie/2", { visibility: "public" }),
        entry("movie/3", { visibility: "friends" }),
        entry("movie/4", { visibility: "private" }),
        entry("movie/5"),
      ]),
    );

    expect(preview.shared).toEqual({ public: 1, friends: 1 });
  });
});

describe("export, delete the account, create another, import", () => {
  it("brings the library back from the file", async () => {
    const ana = await newUser({ clerkId: "user_round_trip" });
    const first = await saveMedia(db, movie(1));
    const second = await saveMedia(db, series(2));
    for (const media of [first, second]) await addEntry(db, ana.id, media);
    await saveEntry(db, ana.id, first, {
      status: "completed",
      progress: 0,
      score: 10,
      startedAt: "2026-01-01",
      finishedAt: "2026-01-09",
      notes: "Una nota\ncon salto",
      visibility: "public",
    });
    await addViewing(db, ana.id, first, {
      startedOn: "2024-05-01",
      finishedOn: "2024-05-03",
      notes: "En el cine",
    });
    await saveEntry(db, ana.id, second, {
      status: "paused",
      progress: 0,
      score: null,
      startedAt: "2026-02-01",
      finishedAt: null,
      notes: null,
      visibility: "private",
    });

    const exported = JSON.parse(
      JSON.stringify(await exportAccount(db, ana.id)),
    ) as { libraryEntries: unknown[] };
    await eraseAccount(db, "user_round_trip");
    expect(await db.select().from(libraryEntries)).toHaveLength(0);

    const again = await newUser();
    const result = await runImport(
      { db, providers: [provider()] },
      again.id,
      (() => {
        const parsed = parseImportFile(JSON.stringify(exported));
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      })(),
      { replace: false, keepVisibility: true, locale: "es" },
    );

    expect(result).toMatchObject({ added: 2, skipped: [] });
    expect(await getEntry(db, again.id, first, "es")).toMatchObject({
      status: "completed",
      score: 10,
      startedAt: "2026-01-01",
      finishedAt: "2026-01-09",
      notes: "Una nota\ncon salto",
      // The person kept the visibility of the file.
      visibility: "public",
    });
    expect(await getEntry(db, again.id, second, "es")).toMatchObject({
      status: "paused",
      startedAt: "2026-02-01",
      visibility: "private",
    });
    expect(await listViewings(db, again.id, first)).toEqual([
      expect.objectContaining({
        startedOn: "2024-05-01",
        finishedOn: "2024-05-03",
        notes: "En el cine",
      }),
    ]);
    expect(await db.select().from(libraryViewings)).toHaveLength(1);
  });
});
