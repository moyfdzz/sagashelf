import { describe, expect, it } from "vitest";

import { maxImportEntries, parseImportFile } from "./import-file";

// Made-up titles and ids: a real backup never goes in the repository.
const show = (overrides: Record<string, unknown> = {}, ids = {}) => ({
  status: "completed",
  user_rating: 8,
  last_watched_at: "2024-03-05T21:10:00Z",
  watched_episodes_count: 12,
  total_episodes_count: 12,
  show: {
    title: "Serie de prueba",
    year: 2019,
    ids: { simkl: 1, tmdb: "1001", imdb: "tt0000001", ...ids },
  },
  ...overrides,
});

const movie = (overrides: Record<string, unknown> = {}, ids = {}) => ({
  status: "completed",
  user_rating: 10,
  last_watched_at: "2023-12-24T00:00:00Z",
  watched_episodes_count: 0,
  movie: {
    title: "Pelicula de prueba",
    year: 2020,
    ids: { simkl: 2, tmdb: "2002", ...ids },
  },
  ...overrides,
});

const anime = (
  overrides: Record<string, unknown> = {},
  ids: Record<string, unknown> = {},
) => ({
  ...show(overrides, ids),
  anime_type: "tv",
});

const backup = (lists: Record<string, unknown[]>) => JSON.stringify(lists);

function parsed(text: string) {
  const result = parseImportFile(text);
  if (!result.ok) throw new Error(`Expected a valid file, got ${result.error}`);
  return result.value;
}

describe("a Simkl backup", () => {
  it("turns a show, an anime and a movie into entries with a TMDB id", () => {
    const { entries, skipped } = parsed(
      backup({
        shows: [show()],
        anime: [anime({}, { tmdb: "3003" })],
        movies: [movie()],
      }),
    );
    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.key)).toEqual([
      "tmdb:tv/1001",
      "tmdb:tv/3003",
      "tmdb:movie/2002",
    ]);
    expect(entries[0]?.entry).toMatchObject({
      title: "Serie de prueba",
      status: "completed",
      progress: 12,
      progressUnit: null,
      score: 8,
      startedAt: null,
      finishedAt: "2024-03-05",
      notes: null,
      visibility: "private",
    });
  });

  it("maps each status", () => {
    const statuses = {
      completed: "completed",
      plantowatch: "planned",
      watching: "in_progress",
      hold: "paused",
      dropped: "dropped",
    } as const;
    const { entries } = parsed(
      backup({
        shows: Object.keys(statuses).map((status, i) =>
          show({ status }, { tmdb: String(100 + i) }),
        ),
      }),
    );
    expect(entries.map((e) => e.entry.status)).toEqual(Object.values(statuses));
  });

  it("lists an entry with an unknown status as invalid and imports the rest", () => {
    const { entries, skipped } = parsed(
      backup({
        shows: [show({ status: "mystery" }, { tmdb: "5" }), show()],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([{ title: "Serie de prueba", reason: "invalid" }]);
  });

  it("asks TMDB for an anime movie as a movie, and an OVA or an ONA as a series", () => {
    const { entries } = parsed(
      backup({
        anime: [
          { ...anime({}, { tmdb: "10" }), anime_type: "movie" },
          { ...anime({}, { tmdb: "11" }), anime_type: "ova" },
          { ...anime({}, { tmdb: "12" }), anime_type: "ona" },
          { ...anime({}, { tmdb: "13" }), anime_type: undefined },
        ],
      }),
    );
    expect(entries.map((e) => e.key)).toEqual([
      "tmdb:movie/10",
      "tmdb:tv/11",
      "tmdb:tv/12",
      "tmdb:tv/13",
    ]);
  });

  it("skips, with its title and year, an anime that has no TMDB id", () => {
    const { entries, skipped } = parsed(
      backup({
        anime: [
          {
            ...anime(),
            show: {
              title: "Anime sin id",
              year: 2015,
              ids: { simkl: 9, mal: 1, anilist: 2, anidb: 3, kitsu: 4 },
            },
          },
        ],
      }),
    );
    expect(entries).toEqual([]);
    expect(skipped).toEqual([
      { title: "Anime sin id (2015)", reason: "no_source" },
    ]);
  });

  it("takes a TMDB id that is not a plain number as no id", () => {
    const { entries, skipped } = parsed(
      backup({
        shows: [
          show({}, { tmdb: "12/../9" }),
          show({}, { tmdb: 0 }),
          show({}, { tmdb: null }),
          show({}, { tmdb: { id: 1 } }),
          show({}, { tmdb: 1.5 }),
        ],
      }),
    );
    expect(entries).toEqual([]);
    expect(skipped).toHaveLength(5);
    expect(skipped.every((s) => s.reason === "no_source")).toBe(true);
  });

  it("counts a title that appears twice once", () => {
    const { entries, skipped } = parsed(
      backup({ shows: [show()], anime: [anime()] }),
    );
    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([
      { title: "Serie de prueba", reason: "duplicate" },
    ]);
  });

  it("reads the rating only when it is a whole number from 1 to 10, and keeps the entry otherwise", () => {
    const { entries, skipped } = parsed(
      backup({
        shows: [
          show({ user_rating: null }, { tmdb: "20" }),
          show({ user_rating: 7 }, { tmdb: "21" }),
          show({ user_rating: 7.5 }, { tmdb: "22" }),
          show({ user_rating: 11 }, { tmdb: "23" }),
          show({ user_rating: 0 }, { tmdb: "24" }),
        ],
      }),
    );
    expect(entries.map((e) => e.entry.score)).toEqual([
      null,
      7,
      null,
      null,
      null,
    ]);
    expect(skipped).toEqual([]);
  });

  it("keeps the finish date only for a completed title and ignores a bad date", () => {
    const { entries } = parsed(
      backup({
        shows: [
          show({ status: "watching" }, { tmdb: "30" }),
          show({ last_watched_at: "yesterday" }, { tmdb: "31" }),
          show({ last_watched_at: null }, { tmdb: "32" }),
        ],
      }),
    );
    expect(entries.map((e) => e.entry.finishedAt)).toEqual([null, null, null]);
  });

  it("gives a movie no episodes and reads a bad count as zero", () => {
    const { entries } = parsed(
      backup({
        movies: [movie({ watched_episodes_count: 5 })],
        shows: [
          show({ watched_episodes_count: -3 }, { tmdb: "40" }),
          show({ watched_episodes_count: "many" }, { tmdb: "41" }),
        ],
      }),
    );
    expect(entries.map((e) => e.entry.progress)).toEqual([0, 0, 0]);
  });

  it("reads only the fields it needs: the rest of the entry is left alone", () => {
    const { entries } = parsed(
      backup({
        shows: [
          show({
            notes: "SECRET",
            visibility: "public",
            source: { provider: "tmdb", id: "tv/999" },
            seasons: [{ number: 1 }],
          }),
        ],
      }),
    );
    expect(entries[0]?.key).toBe("tmdb:tv/1001");
    expect(entries[0]?.entry.notes).toBeNull();
    expect(entries[0]?.entry.visibility).toBe("private");
    expect(JSON.stringify(entries)).not.toContain("SECRET");
  });

  it("survives lists and entries of the wrong type", () => {
    const { entries, skipped } = parsed(
      backup({
        shows: [null, 5, "text", [], { show: "x" }, show()],
        anime: [],
        movies: [],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(skipped).toHaveLength(5);
  });

  it("is a Simkl file with one list that is not a list, and not an export", () => {
    expect(parseImportFile(JSON.stringify({ shows: "x" }))).toEqual({
      ok: false,
      error: "invalid_file",
    });
    expect(parseImportFile(JSON.stringify({ shows: [], movies: [] }))).toEqual({
      ok: true,
      value: { entries: [], skipped: [] },
    });
  });

  it("refuses a file with more entries than the limit, counted across the lists", () => {
    const half = Math.floor(maxImportEntries / 2) + 1;
    const result = parseImportFile(
      backup({
        shows: Array.from({ length: half }, () => ({})),
        movies: Array.from({ length: half }, () => ({})),
      }),
    );
    expect(result).toEqual({ ok: false, error: "too_many" });
  });

  it("does not take a file of our own export for a Simkl backup", () => {
    const result = parseImportFile(
      JSON.stringify({ schemaVersion: 1, libraryEntries: [], shows: [show()] }),
    );
    expect(result).toEqual({
      ok: true,
      value: { entries: [], skipped: [] },
    });
  });
});
