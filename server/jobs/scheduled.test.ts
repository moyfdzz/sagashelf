import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import { runScheduledJobs, runTvmazeJobs, tvmazeCron } from "./scheduled";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getMediaProviders: vi.fn(),
  getWikidata: vi.fn(),
  refreshStaleMedia: vi.fn(),
  enrichWithWikidata: vi.fn(),
  syncSagas: vi.fn(),
  proposeSagaDrafts: vi.fn(),
  getTvmaze: vi.fn(),
  refreshNextEpisodes: vi.fn(),
}));

vi.mock("../runtime-env", () => ({
  getDb: mocks.getDb,
  getMediaProviders: mocks.getMediaProviders,
  getWikidata: mocks.getWikidata,
  getTvmaze: mocks.getTvmaze,
}));
vi.mock("./refresh-next-episodes", () => ({
  refreshNextEpisodes: mocks.refreshNextEpisodes,
}));
vi.mock("./sync-sagas", () => ({ syncSagas: mocks.syncSagas }));
vi.mock("../db/saga-drafts", () => ({
  proposeSagaDrafts: mocks.proposeSagaDrafts,
}));
vi.mock("./enrich-wikidata", () => ({
  enrichWithWikidata: mocks.enrichWithWikidata,
}));
vi.mock("./refresh-stale-media", () => ({
  refreshStaleMedia: mocks.refreshStaleMedia,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("runScheduledJobs", () => {
  it("refreshes the stale titles and logs the summary", async () => {
    const db = { execute: vi.fn() };
    const providers = [{ id: "tmdb" }];
    mocks.getMediaProviders.mockReturnValue(providers);
    mocks.getDb.mockResolvedValue(db);
    mocks.refreshStaleMedia.mockResolvedValue({
      found: 2,
      refreshed: 2,
      failed: 0,
    });

    await runScheduledJobs();

    expect(mocks.refreshStaleMedia).toHaveBeenCalledWith({ db, providers });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "media.refresh_batch",
        found: 2,
        refreshed: 2,
        failed: 0,
      }),
    );
  });

  it("leaves the database asleep when there is no provider", async () => {
    mocks.getMediaProviders.mockReturnValue([]);

    await runScheduledJobs();

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.refreshStaleMedia).not.toHaveBeenCalled();
  });

  it("logs a failure by name and does not throw", async () => {
    mocks.getMediaProviders.mockReturnValue([{ id: "tmdb" }]);
    mocks.getDb.mockRejectedValue(new TypeError("no database"));

    await expect(runScheduledJobs()).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "refresh-stale-media",
        error: "TypeError",
      }),
    );
  });

  it("looks titles up in Wikidata after the refresh, when it is switched on", async () => {
    const db = { execute: vi.fn() };
    const wikidata = { lookup: vi.fn(), members: vi.fn() };
    mocks.getMediaProviders.mockReturnValue([]);
    mocks.getWikidata.mockReturnValue(wikidata);
    mocks.getDb.mockResolvedValue(db);
    mocks.enrichWithWikidata.mockResolvedValue({
      found: 3,
      matched: 2,
      unknown: 1,
      items: 9,
    });

    await runScheduledJobs();

    expect(mocks.enrichWithWikidata).toHaveBeenCalledWith({ db, wikidata });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "wikidata.batch",
        found: 3,
        matched: 2,
        unknown: 1,
        items: 9,
      }),
    );
  });

  it("does not look anything up when Wikidata is off", async () => {
    mocks.getMediaProviders.mockReturnValue([]);
    mocks.getWikidata.mockReturnValue(null);

    await runScheduledJobs();

    expect(mocks.enrichWithWikidata).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("runs the Wikidata job even when the refresh fails, and logs each failure by name", async () => {
    mocks.getMediaProviders.mockReturnValue([{ id: "tmdb" }]);
    mocks.getDb.mockResolvedValue({ execute: vi.fn() });
    mocks.refreshStaleMedia.mockRejectedValue(new TypeError("boom"));
    mocks.getWikidata.mockReturnValue({});
    mocks.enrichWithWikidata.mockRejectedValue(new RangeError("slow"));

    await expect(runScheduledJobs()).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "refresh-stale-media",
        error: "TypeError",
      }),
    );
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "enrich-wikidata",
        error: "RangeError",
      }),
    );
  });

  it("syncs the curated sagas after the Wikidata job, when it is switched on (SAG-25)", async () => {
    const db = { execute: vi.fn() };
    const wikidata = { lookup: vi.fn(), members: vi.fn() };
    mocks.getMediaProviders.mockReturnValue([]);
    mocks.getWikidata.mockReturnValue(wikidata);
    mocks.getDb.mockResolvedValue(db);
    mocks.enrichWithWikidata.mockResolvedValue({
      found: 0,
      matched: 0,
      unknown: 0,
      items: 0,
    });
    mocks.syncSagas.mockResolvedValue({ sagas: 21, items: 160 });

    await runScheduledJobs();

    expect(mocks.syncSagas).toHaveBeenCalledWith({ db, wikidata });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "sagas.sync", sagas: 21, items: 160 }),
    );
  });

  it("logs a failure of the saga sync by name and does not throw", async () => {
    mocks.getMediaProviders.mockReturnValue([]);
    mocks.getWikidata.mockReturnValue({});
    mocks.getDb.mockResolvedValue({ execute: vi.fn() });
    mocks.enrichWithWikidata.mockResolvedValue({});
    mocks.syncSagas.mockRejectedValue(new SyntaxError("bad"));

    await expect(runScheduledJobs()).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "sync-sagas",
        error: "SyntaxError",
      }),
    );
  });

  it("does not sync sagas when Wikidata is off", async () => {
    mocks.getMediaProviders.mockReturnValue([]);
    mocks.getWikidata.mockReturnValue(null);

    await runScheduledJobs();

    expect(mocks.syncSagas).not.toHaveBeenCalled();
  });

  describe("the drafts of sagas (SAG-92)", () => {
    const db = { execute: vi.fn() };
    const setUp = (sync: { sagas: number; items: number }) => {
      mocks.getMediaProviders.mockReturnValue([]);
      mocks.getWikidata.mockReturnValue({});
      mocks.getDb.mockResolvedValue(db);
      mocks.enrichWithWikidata.mockResolvedValue({});
      mocks.syncSagas.mockResolvedValue(sync);
    };

    it("proposes drafts in a run where the sync had nothing to do, and logs how many", async () => {
      setUp({ sagas: 0, items: 0 });
      mocks.proposeSagaDrafts.mockResolvedValue(2);

      await runScheduledJobs();

      expect(mocks.proposeSagaDrafts).toHaveBeenCalledWith(db);
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({ event: "sagas.drafts", created: 2 }),
      );
    });

    it("says nothing when no draft was made", async () => {
      setUp({ sagas: 0, items: 0 });
      mocks.proposeSagaDrafts.mockResolvedValue(0);

      await runScheduledJobs();

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining("sagas.drafts"),
      );
    });

    it("waits for a quiet run, so the subrequests of a busy one are not passed", async () => {
      setUp({ sagas: 21, items: 0 });
      await runScheduledJobs();
      setUp({ sagas: 0, items: 160 });
      await runScheduledJobs();

      expect(mocks.proposeSagaDrafts).not.toHaveBeenCalled();
    });

    it("logs a failure by name and does not throw", async () => {
      setUp({ sagas: 0, items: 0 });
      mocks.proposeSagaDrafts.mockRejectedValue(new RangeError("slow"));

      await expect(runScheduledJobs()).resolves.toBeUndefined();

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "job.failed",
          job: "propose-saga-drafts",
          error: "RangeError",
        }),
      );
    });
  });
});

describe("the second Cron Trigger (SAG-90)", () => {
  it("is declared in wrangler.jsonc next to the first, so the handler can tell them apart", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");

    expect(config).toContain(`"${tvmazeCron}"`);
    expect(config).toContain('"0 */6 * * *"');
    expect(tvmazeCron).not.toBe("0 */6 * * *");
  });

  it("asks TVmaze for the next episodes with its own client and logs the summary", async () => {
    const db = { execute: vi.fn() };
    const tvmaze = { getShow: vi.fn() };
    mocks.getTvmaze.mockReturnValue(tvmaze);
    mocks.getDb.mockResolvedValue(db);
    mocks.refreshNextEpisodes.mockResolvedValue({
      found: 4,
      saved: 3,
      withNext: 2,
      failed: 1,
      stopped: false,
    });

    await runTvmazeJobs();

    expect(mocks.refreshNextEpisodes).toHaveBeenCalledWith({ db, tvmaze });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "tvmaze.batch",
        found: 4,
        saved: 3,
        withNext: 2,
        failed: 1,
        stopped: false,
      }),
    );
  });

  it("leaves the database asleep when TVmaze is off", async () => {
    mocks.getTvmaze.mockReturnValue(null);

    await runTvmazeJobs();

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.refreshNextEpisodes).not.toHaveBeenCalled();
  });

  it("logs a failure by name and does not throw", async () => {
    mocks.getTvmaze.mockReturnValue({});
    mocks.getDb.mockResolvedValue({ execute: vi.fn() });
    mocks.refreshNextEpisodes.mockRejectedValue(new TypeError("no table"));

    await expect(runTvmazeJobs()).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "refresh-next-episodes",
        error: "TypeError",
      }),
    );
  });

  it("does not run the jobs of the first trigger", async () => {
    mocks.getTvmaze.mockReturnValue(null);

    await runTvmazeJobs();

    expect(mocks.getMediaProviders).not.toHaveBeenCalled();
    expect(mocks.enrichWithWikidata).not.toHaveBeenCalled();
    expect(mocks.syncSagas).not.toHaveBeenCalled();
  });
});
