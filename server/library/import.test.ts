import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseImportFile } from "./import-file";
import { runImport, type FetchSpend } from "./import";

const mocks = vi.hoisted(() => ({
  lookupTitles: vi.fn(),
  writeEntries: vi.fn(),
  importMedia: vi.fn(),
}));

vi.mock("../db/import", () => ({
  lookupTitles: mocks.lookupTitles,
  writeEntries: mocks.writeEntries,
}));
vi.mock("../media/import", () => ({ importMedia: mocks.importMedia }));

const entry = (n: number) => ({
  title: `Title ${n}`,
  source: { provider: "tmdb", id: `movie/${n}` },
  status: "completed",
  progress: 0,
  score: null,
  startedAt: null,
  finishedAt: null,
  notes: null,
  viewings: [],
});

function fileOf(count: number) {
  const parsed = parseImportFile(
    JSON.stringify({
      schemaVersion: 1,
      libraryEntries: Array.from({ length: count }, (_, n) => entry(n + 1)),
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const refund = vi.fn<(units: number) => Promise<void>>();

const run = (spendFetch: () => Promise<FetchSpend>, count: number) =>
  runImport(
    {
      db: {} as never,
      providers: [{ id: "tmdb" }] as never,
      spendFetch,
      refundFetches: refund,
    },
    "user-1",
    fileOf(count),
    { replace: false, locale: "es" },
  );

beforeEach(() => {
  // Nothing is held, so every entry of the file needs the provider.
  mocks.lookupTitles.mockReset().mockResolvedValue(new Map());
  mocks.writeEntries.mockReset().mockResolvedValue({ added: 0, replaced: 0 });
  mocks.importMedia.mockReset().mockResolvedValue(null);
  refund.mockReset().mockResolvedValue(undefined);
});

describe("the budget of new titles in an import (SAG-188, ADR-035)", () => {
  it("asks the provider for nothing, and says so, once the budget is spent", async () => {
    const spend = vi.fn().mockResolvedValue("burst");

    const result = await run(spend, 4);

    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([
      { title: "Title 1", reason: "pending" },
      { title: "Title 2", reason: "pending" },
      { title: "Title 3", reason: "pending" },
      { title: "Title 4", reason: "pending" },
    ]);
  });

  it("spends one unit for each title asked of the provider, and stops at the first refusal", async () => {
    const spend = vi
      .fn()
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("ok")
      .mockResolvedValue("burst");

    const result = await run(spend, 5);

    expect(spend).toHaveBeenCalledTimes(3);
    expect(mocks.importMedia).toHaveBeenCalledTimes(2);
    expect(mocks.importMedia.mock.calls.map((call) => call[2])).toEqual([
      "movie/1",
      "movie/2",
    ]);
    // The provider did not know the two it was asked for; the other three wait for another import.
    expect(
      result.skipped.filter(({ reason }) => reason === "pending"),
    ).toHaveLength(3);
  });

  it("spends nothing for a title we already hold", async () => {
    mocks.lookupTitles.mockResolvedValue(
      new Map([
        [
          "tmdb:movie/1",
          { mediaId: "m1", hasEntry: false, type: "movie", episodes: null },
        ],
      ]),
    );
    const spend = vi.fn().mockResolvedValue("ok");

    await run(spend, 1);

    expect(spend).not.toHaveBeenCalled();
    expect(mocks.importMedia).not.toHaveBeenCalled();
  });
  it("says the day is over, not that another import brings the titles, when the daily budget is spent", async () => {
    const spend = vi
      .fn()
      .mockResolvedValueOnce("ok")
      .mockResolvedValue("daily");

    const result = await run(spend, 3);

    expect(spend).toHaveBeenCalledTimes(2);
    expect(
      result.skipped.filter(({ reason }) => reason === "daily_limit"),
    ).toEqual([
      { title: "Title 2", reason: "daily_limit" },
      { title: "Title 3", reason: "daily_limit" },
    ]);
    expect(result.skipped.some(({ reason }) => reason === "pending")).toBe(
      false,
    );
  });

  it("gives back the units of the titles the provider did not answer, and keeps the ones it answered", async () => {
    mocks.importMedia
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("provider down"))
      .mockRejectedValueOnce(new Error("provider down"));

    await run(vi.fn().mockResolvedValue("ok"), 3);

    // One not found (the call was made and stays spent), two that did not answer.
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith(2);
  });
});
