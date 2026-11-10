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
