import { beforeEach, describe, expect, it, vi } from "vitest";

import { processImportBatch } from "./process-imports";

const mocks = vi.hoisted(() => ({
  claimImportRows: vi.fn(),
  finishImportRows: vi.fn(),
  pauseUntilTomorrow: vi.fn(),
  lookupTitles: vi.fn(),
  writeEntries: vi.fn(),
  claimTitleFetch: vi.fn(),
  refundTitleFetches: vi.fn(),
  importMedia: vi.fn(),
}));

vi.mock("../db/import-queue", () => ({
  claimImportRows: mocks.claimImportRows,
  finishImportRows: mocks.finishImportRows,
  pauseUntilTomorrow: mocks.pauseUntilTomorrow,
}));
vi.mock("../db/import", () => ({
  lookupTitles: mocks.lookupTitles,
  writeEntries: mocks.writeEntries,
}));
vi.mock("../db/title-budget", () => ({
  claimTitleFetch: mocks.claimTitleFetch,
  refundTitleFetches: mocks.refundTitleFetches,
}));
vi.mock("../media/import", () => ({ importMedia: mocks.importMedia }));

const row = (n: number) => ({
  id: `row-${n}`,
  jobId: "job-1",
  userId: "user-1",
  position: n,
  title: `Title ${n}`,
  entry: {
    title: `Title ${n}`,
    source: { provider: "tmdb", id: `movie/${n}` },
    status: "completed",
    progress: 0,
    score: null,
    startedAt: null,
    finishedAt: null,
    notes: null,
    viewings: [],
  },
  attempts: 0,
  replace: false,
  keepVisibility: false,
  locale: "es",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.lookupTitles.mockResolvedValue(new Map());
  mocks.writeEntries.mockResolvedValue({ added: 0, replaced: 0 });
});

const run = () =>
  processImportBatch({
    db: {} as never,
    providers: [{ id: "tmdb" }] as never,
  });

describe("a failure in the run of a person (SAG-241 review)", () => {
  it("gives back the units taken for titles the provider was never asked for", async () => {
    mocks.claimImportRows.mockResolvedValue([row(1), row(2), row(3)]);
    mocks.claimTitleFetch
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("database blip"));

    const summary = await run();

    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.refundTitleFetches).toHaveBeenCalledWith({}, "user-1", 2);
    // Every row of the person counts a try, and the run still finishes.
    expect(mocks.finishImportRows.mock.calls[0]?.[1].retry).toEqual([
      "row-1",
      "row-2",
      "row-3",
    ]);
    expect(summary.retried).toBe(3);
  });

  it("does not refund units for calls the provider did answer", async () => {
    mocks.claimImportRows.mockResolvedValue([row(1)]);
    mocks.claimTitleFetch.mockResolvedValue("ok");
    mocks.importMedia.mockResolvedValue({ id: "m1" });
    mocks.lookupTitles
      .mockResolvedValueOnce(new Map())
      .mockRejectedValueOnce(new Error("database blip"));

    await run();

    expect(mocks.importMedia).toHaveBeenCalledTimes(1);
    expect(mocks.refundTitleFetches).not.toHaveBeenCalled();
  });
});

describe("an entry with a name and a year but no id (SAG-243)", () => {
  const matchRow = (n: number) => {
    return {
      ...row(n),
      // No source, as a row stored for a title with only a name and a year.
      entry: {
        ...row(n).entry,
        source: undefined,
        match: { kind: "tv", title: `Name ${n}`, year: 2015 },
      },
    };
  };
  const runWith = (matchByYear: unknown) =>
    processImportBatch({
      db: {} as never,
      providers: [{ id: "tmdb", matchByYear }] as never,
    });

  it("is looked up, and then saved like any title with the id found", async () => {
    mocks.claimImportRows.mockResolvedValue([matchRow(1)]);
    mocks.claimTitleFetch.mockResolvedValue("ok");
    mocks.importMedia.mockResolvedValue({ id: "m1" });
    // Not held yet at the first look, held once it was saved.
    mocks.lookupTitles
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(
        new Map([["tmdb:tv/42", { mediaId: "m1", hasEntry: false }]]),
      );
    mocks.writeEntries.mockResolvedValue({ added: 1, replaced: 0 });
    const matchByYear = vi.fn().mockResolvedValue("tv/42");

    await runWith(matchByYear);

    expect(matchByYear).toHaveBeenCalledWith(
      { kind: "tv", title: "Name 1", year: 2015 },
      { locale: "es" },
    );
    expect(mocks.importMedia).toHaveBeenCalledWith(
      expect.anything(),
      "tmdb",
      "tv/42",
      "es",
    );
    expect(mocks.finishImportRows.mock.calls[0]?.[1].done).toEqual(["row-1"]);
  });

  it("is listed as having no catalog id when no series fits, and costs no budget", async () => {
    mocks.claimImportRows.mockResolvedValue([matchRow(1)]);

    await runWith(vi.fn().mockResolvedValue(null));

    expect(mocks.claimTitleFetch).not.toHaveBeenCalled();
    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(mocks.finishImportRows.mock.calls[0]?.[1].skipped).toEqual([
      { id: "row-1", reason: "no_source" },
    ]);
  });

  it("counts a try when TMDB does not answer, and the others of the run still go on", async () => {
    mocks.claimImportRows.mockResolvedValue([matchRow(1)]);

    const summary = await runWith(vi.fn().mockRejectedValue(new Error("down")));

    expect(mocks.finishImportRows.mock.calls[0]?.[1].retry).toEqual(["row-1"]);
    expect(summary.retried).toBe(1);
  });

  it("is listed as having no catalog id when the provider cannot match", async () => {
    mocks.claimImportRows.mockResolvedValue([matchRow(1)]);

    await runWith(undefined);

    expect(mocks.finishImportRows.mock.calls[0]?.[1].skipped).toEqual([
      { id: "row-1", reason: "no_source" },
    ]);
  });
});
