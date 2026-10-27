import { describe, expect, it } from "vitest";

import {
  maxImportBytes,
  maxImportEntries,
  normalizeImported,
  parseImportFile,
  type ImportEntry,
} from "./import-file";

const entry = (overrides: Record<string, unknown> = {}) => ({
  title: "Interestelar",
  source: { provider: "tmdb", id: "movie/157336" },
  status: "completed",
  progress: 0,
  score: 9,
  startedAt: "2026-01-01",
  finishedAt: "2026-01-02",
  notes: "Muy buena",
  viewings: [],
  ...overrides,
});

const file = (entries: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, libraryEntries: entries, ...extra });

function parsed(text: string) {
  const result = parseImportFile(text);
  if (!result.ok) throw new Error(`Expected a valid file, got ${result.error}`);
  return result.value;
}

describe("parseImportFile", () => {
  it("reads the entries of a file made by the export", () => {
    const { entries, skipped } = parsed(
      file([
        entry({
          viewings: [
            {
              startedOn: "2025-05-01",
              finishedOn: "2025-05-03",
              notes: "Cine",
            },
          ],
        }),
      ]),
    );

    expect(skipped).toEqual([]);
    expect(entries).toEqual([
      {
        key: "tmdb:movie/157336",
        entry: expect.objectContaining({
          status: "completed",
          score: 9,
          viewings: [
            {
              startedOn: "2025-05-01",
              finishedOn: "2025-05-03",
              notes: "Cine",
            },
          ],
        }),
      },
    ]);
  });

  it.each([
    ["not JSON", "this is not json"],
    ["a list", "[]"],
    ["a number", "42"],
    ["null", "null"],
    ["no entries", JSON.stringify({ schemaVersion: 1 })],
    [
      "entries that are not a list",
      JSON.stringify({ schemaVersion: 1, libraryEntries: {} }),
    ],
  ])("refuses a file that is %s", (_name, text) => {
    expect(parseImportFile(text)).toEqual({ ok: false, error: "invalid_file" });
  });

  it("refuses a version it does not know, and a file without one", () => {
    expect(
      parseImportFile(JSON.stringify({ schemaVersion: 2, libraryEntries: [] })),
    ).toEqual({ ok: false, error: "unsupported_version" });
    expect(parseImportFile(JSON.stringify({ libraryEntries: [] }))).toEqual({
      ok: false,
      error: "invalid_file",
    });
  });

  it("refuses a file with more entries than the limit", () => {
    const many = Array.from({ length: maxImportEntries + 1 }, (_, i) =>
      entry({ source: { provider: "tmdb", id: `movie/${i}` } }),
    );

    expect(parseImportFile(file(many))).toEqual({
      ok: false,
      error: "too_many",
    });
  });

  it("refuses text over the byte limit, counting bytes and not characters", () => {
    const big = file([entry({ notes: "ñ".repeat(maxImportBytes / 2) })]);

    expect(parseImportFile(big)).toEqual({ ok: false, error: "invalid_file" });
  });

  it("survives nesting deep enough to break a parser", () => {
    const deep = "[".repeat(200_000) + "]".repeat(200_000);

    expect(parseImportFile(deep)).toEqual({ ok: false, error: "invalid_file" });
    expect(
      parseImportFile(
        `{"schemaVersion":1,"libraryEntries":[${"[".repeat(100_000)}${"]".repeat(100_000)}]}`,
      ).ok,
    ).toBe(true);
  });

  it("ignores everything that is not a library entry field: the profile, ids and the visibility", () => {
    const { entries } = parsed(
      file(
        [
          entry({
            visibility: "public",
            userId: "00000000-0000-0000-0000-000000000000",
            user_id: "someone-else",
            mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
            rewatchCount: 99,
          }),
        ],
        { profile: { username: "other" }, lists: [{ title: "x" }] },
      ),
    );

    const read = entries[0]?.entry as ImportEntry;
    expect(Object.keys(read).sort()).toEqual(
      [
        "finishedAt",
        "notes",
        "progress",
        "score",
        "source",
        "startedAt",
        "status",
        "title",
        "viewings",
      ].sort(),
    );
  });

  it("lists, and leaves out, the entries that do not pass, and imports the rest", () => {
    const { entries, skipped } = parsed(
      file([
        entry({ source: { provider: "tmdb", id: "movie/1" } }),
        entry({ title: "Sin fuente", source: null }),
        entry({ title: "Estado raro", status: "watching" }),
        entry({ title: "Puntuación", score: 11 }),
        entry({ title: "Progreso", progress: -1 }),
        entry({
          title: "Fechas",
          startedAt: "2026-05-02",
          finishedAt: "2026-05-01",
        }),
        entry({ title: "Fecha falsa", startedAt: "2026-02-31" }),
        entry({ title: "Notas largas", notes: "x".repeat(2001) }),
        entry({
          title: "Id raro",
          source: { provider: "tmdb", id: "movie/1; DROP TABLE" },
        }),
        entry({
          title: "Fuente rara",
          source: { provider: "TMDB'--", id: "movie/2" },
        }),
        "not even an object",
        null,
      ]),
    );

    expect(entries).toHaveLength(1);
    expect(skipped.map((item) => item.reason)).toEqual([
      "no_source",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "no_source",
      "no_source",
    ]);
  });

  it("counts an entry that appears twice once", () => {
    const { entries, skipped } = parsed(file([entry(), entry({ score: 1 })]));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.score).toBe(9);
    expect(skipped).toEqual([{ title: "Interestelar", reason: "duplicate" }]);
  });

  it("trims the notes, counts characters, and drops viewings that are not valid", () => {
    const { entries } = parsed(
      file([
        entry({
          notes: "  una nota \r\n",
          viewings: [
            {
              startedOn: "2025-05-01",
              finishedOn: "2025-05-03",
              notes: "💥".repeat(500),
            },
            { startedOn: "no date", finishedOn: null, notes: null },
          ],
        }),
      ]),
    );

    expect(entries[0]?.entry.notes).toBe("una nota");
    expect(entries[0]?.entry.viewings).toHaveLength(2);
    expect(entries[0]?.entry.viewings[1]).toEqual({
      startedOn: null,
      finishedOn: null,
      notes: null,
    });
  });
});

describe("normalizeImported", () => {
  const read = (overrides: Record<string, unknown> = {}) => {
    const [first] = parsed(file([entry(overrides)])).entries;
    if (!first) throw new Error("Expected an entry");
    return first.entry;
  };

  it("gives a completed title all its episodes", () => {
    expect(normalizeImported(read({ progress: 3 }), 12).progress).toBe(12);
  });

  it("never lets the progress pass the last episode", () => {
    expect(
      normalizeImported(read({ status: "in_progress", progress: 999 }), 12)
        .progress,
    ).toBe(12);
  });

  it("makes a planned title with episodes seen a title in progress", () => {
    expect(
      normalizeImported(
        read({ status: "planned", progress: 2, finishedAt: null }),
        12,
      ).status,
    ).toBe("in_progress");
  });

  it("keeps the finish date only for a completed title, and invents no date", () => {
    const paused = normalizeImported(
      read({ status: "paused", finishedAt: "2026-01-02", startedAt: null }),
      0,
    );
    const completed = normalizeImported(
      read({ finishedAt: null, startedAt: null }),
      0,
    );

    expect(paused).toMatchObject({ finishedAt: null, startedAt: null });
    expect(completed).toMatchObject({ finishedAt: null, startedAt: null });
  });

  it("leaves the progress of a title with no episodes as it is", () => {
    expect(normalizeImported(read({ progress: 5 }), 0).progress).toBe(5);
  });
});
