import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseImportFile } from "./import-file";
import { runImport } from "./import";

const mocks = vi.hoisted(() => ({
  lookupTitles: vi.fn(),
  writeEntries: vi.fn(),
  enqueueImport: vi.fn(),
}));

vi.mock("../db/import", () => ({
  lookupTitles: mocks.lookupTitles,
  writeEntries: mocks.writeEntries,
}));
vi.mock("../db/import-queue", () => ({
  enqueueImport: mocks.enqueueImport,
}));

const entry = (n: number, provider = "tmdb") => ({
  title: `Title ${n}`,
  source: { provider, id: `movie/${n}` },
  status: "completed",
  progress: 0,
  score: null,
  startedAt: null,
  finishedAt: null,
  notes: null,
  viewings: [],
});

function fileOf(entries: unknown[]) {
  const parsed = parseImportFile(
    JSON.stringify({ schemaVersion: 1, libraryEntries: entries }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const held = (mediaId: string) => ({
  mediaId,
  hasEntry: false,
  type: "movie",
  episodes: 0,
});

const run = (entries: unknown[], replace = false) =>
  runImport(
    { db: {} as never, providers: [{ id: "tmdb" }] as never },
    "user-1",
    fileOf(entries),
    { replace, keepVisibility: true, locale: "en" },
  );

beforeEach(() => {
  // Nothing is held, so every entry of the file needs the provider.
  mocks.lookupTitles.mockReset().mockResolvedValue(new Map());
  mocks.writeEntries.mockReset().mockResolvedValue({ added: 0, replaced: 0 });
  mocks.enqueueImport.mockReset().mockResolvedValue("job-1");
});

describe("the upload of an import (SAG-241, ADR-047)", () => {
  it("queues every title only a provider knows, with no cap, and asks nobody", async () => {
    const result = await run(
      Array.from({ length: 40 }, (_, n) => entry(n + 1)),
    );

    expect(result).toMatchObject({ added: 0, queued: 40, skipped: [] });
    const [, userId, job] = mocks.enqueueImport.mock.calls[0] ?? [];
    expect(userId).toBe("user-1");
    expect(job.pending).toHaveLength(40);
    expect(job.total).toBe(40);
    expect(job.locale).toBe("en");
    expect(job.keepVisibility).toBe(true);
    // Each waiting title keeps its entry, so the queue can write it later.
    expect(job.pending[0]).toMatchObject({
      title: "Title 1",
      entry: { source: { provider: "tmdb", id: "movie/1" } },
    });
  });

  it("writes the titles we hold now and does not queue them", async () => {
    mocks.lookupTitles.mockResolvedValue(
      new Map([["tmdb:movie/1", held("m1")]]),
    );
    mocks.writeEntries.mockResolvedValue({ added: 1, replaced: 0 });

    const result = await run([entry(1), entry(2)]);

    expect(mocks.writeEntries).toHaveBeenCalledTimes(1);
    expect(mocks.writeEntries.mock.calls[0]?.[2]).toHaveLength(1);
    expect(result).toMatchObject({ added: 1, queued: 1 });
    const job = mocks.enqueueImport.mock.calls[0]?.[2];
    expect(job.pending.map((row: { title: string }) => row.title)).toEqual([
      "Title 2",
    ]);
    expect(job.written).toEqual({ added: 1, replaced: 0, kept: 0 });
  });

  it("lists the titles left out, with the reason, in the job", async () => {
    const result = await run([
      entry(1),
      entry(2, "mangadex"),
      { title: "No id", status: "completed" },
    ]);

    expect(result.skipped).toEqual([
      { title: "No id", reason: "no_source" },
      { title: "Title 2", reason: "unsupported_provider" },
    ]);
    const job = mocks.enqueueImport.mock.calls[0]?.[2];
    expect(job.total).toBe(3);
    expect(job.skipped.map((row: { reason: string }) => row.reason)).toEqual([
      "no_source",
      "unsupported_provider",
    ]);
  });

  it("lists the second id of a title as a duplicate, and counts what already existed as kept", async () => {
    mocks.lookupTitles.mockResolvedValue(
      new Map([
        ["tmdb:movie/1", held("m1")],
        ["tmdb:movie/2", held("m1")],
      ]),
    );
    // One row is written but it was already there.
    mocks.writeEntries.mockResolvedValue({ added: 0, replaced: 0 });

    const result = await run([entry(1), entry(2)]);

    expect(mocks.writeEntries.mock.calls[0]?.[2]).toHaveLength(1);
    expect(result).toMatchObject({ kept: 1, queued: 0 });
    expect(result.skipped).toEqual([{ title: "Title 2", reason: "duplicate" }]);
  });

  it("gives every row of the job its own place, so the list keeps an order", async () => {
    await run([entry(1), entry(2, "mangadex"), entry(3)]);

    const job = mocks.enqueueImport.mock.calls[0]?.[2];
    const places = [...job.pending, ...job.skipped].map(
      (row: { position: number }) => row.position,
    );
    expect(new Set(places).size).toBe(places.length);
  });
});

describe("an entry with a name and a year but no id (SAG-243)", () => {
  // No source: the file text leaves out a key that is undefined.
  const wanted = (n: number) => ({
    ...entry(n),
    source: undefined,
    match: { kind: "tv", title: `Name ${n}`, year: 2015 },
  });

  it("waits in the queue with its name and year, counted in the total, and asks nobody", async () => {
    const result = await run([entry(1), wanted(2), wanted(3)]);

    expect(result).toMatchObject({ added: 0, queued: 3, skipped: [] });
    const job = mocks.enqueueImport.mock.calls[0]?.[2];
    expect(job.total).toBe(3);
    expect(job.pending).toHaveLength(3);
    expect(job.pending[1].entry.match).toEqual({
      kind: "tv",
      title: "Name 2",
      year: 2015,
    });
    expect(job.pending[1].entry.source).toBeUndefined();
  });

  it("prefers the id of the entry when it has both", async () => {
    const result = await run([{ ...entry(1), match: wanted(1).match }]);

    expect(result.queued).toBe(1);
    expect(
      mocks.enqueueImport.mock.calls[0]?.[2].pending[0].entry.source,
    ).toEqual({ provider: "tmdb", id: "movie/1" });
  });
});
