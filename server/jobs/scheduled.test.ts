import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import {
  importCron,
  jobsForCron,
  outboxCron,
  runImportJobs,
  runOutboxJobs,
  runScheduledJobs,
  runTvmazeJobs,
  tvmazeCron,
} from "./scheduled";

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
  getWebhooksEnabled: vi.fn(),
  deliverDueEvents: vi.fn(),
  announceNewEpisodes: vi.fn(),
  prunePictureUploads: vi.fn(),
  pruneContactMessages: vi.fn(),
  pruneImportJobs: vi.fn(),
  processImportBatch: vi.fn(),
}));

vi.mock("../runtime-env", () => ({
  getDb: mocks.getDb,
  getMediaProviders: mocks.getMediaProviders,
  getWikidata: mocks.getWikidata,
  getTvmaze: mocks.getTvmaze,
  getWebhooksEnabled: mocks.getWebhooksEnabled,
}));
vi.mock("../db/picture-uploads", () => ({
  prunePictureUploads: mocks.prunePictureUploads,
}));
vi.mock("../db/contact-messages", () => ({
  pruneContactMessages: mocks.pruneContactMessages,
}));
vi.mock("../db/import-queue", () => ({
  pruneImportJobs: mocks.pruneImportJobs,
}));
vi.mock("./process-imports", () => ({
  processImportBatch: mocks.processImportBatch,
}));
vi.mock("../db/episode-alerts", () => ({
  announceNewEpisodes: mocks.announceNewEpisodes,
}));
vi.mock("./deliver-outbox", () => ({
  deliverDueEvents: mocks.deliverDueEvents,
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
  // Nothing came out, unless a test says so.
  mocks.announceNewEpisodes.mockResolvedValue({ episodes: 0, messages: 0 });
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

  it("with TVmaze off, only deletes the old records of picture uploads", async () => {
    const db = { execute: vi.fn() };
    mocks.getTvmaze.mockReturnValue(null);
    mocks.getDb.mockResolvedValue(db);
    mocks.prunePictureUploads.mockResolvedValue(3);

    await runTvmazeJobs();

    expect(mocks.prunePictureUploads).toHaveBeenCalledWith(db);
    expect(mocks.refreshNextEpisodes).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "picture_uploads.pruned", deleted: 3 }),
    );
  });

  it("deletes the old messages of the contact page too, and goes on when that fails (SAG-110)", async () => {
    const db = { execute: vi.fn() };
    mocks.getTvmaze.mockReturnValue({});
    mocks.getDb.mockResolvedValue(db);
    mocks.prunePictureUploads.mockResolvedValue(0);
    mocks.pruneContactMessages.mockResolvedValue(2);
    mocks.refreshNextEpisodes.mockResolvedValue({});

    await runTvmazeJobs();

    expect(mocks.pruneContactMessages).toHaveBeenCalledWith(db);
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "contact_messages.pruned", deleted: 2 }),
    );

    mocks.pruneContactMessages.mockRejectedValue(new TypeError("no table"));
    mocks.refreshNextEpisodes.mockClear();
    await expect(runTvmazeJobs()).resolves.toBeUndefined();
    expect(mocks.refreshNextEpisodes).toHaveBeenCalled();
  });

  it("deletes the imports older than 30 days too, and goes on when that fails (SAG-241)", async () => {
    const db = { execute: vi.fn() };
    mocks.getTvmaze.mockReturnValue({});
    mocks.getDb.mockResolvedValue(db);
    mocks.prunePictureUploads.mockResolvedValue(0);
    mocks.pruneContactMessages.mockResolvedValue(0);
    mocks.pruneImportJobs.mockResolvedValue(4);
    mocks.refreshNextEpisodes.mockResolvedValue({});

    await runTvmazeJobs();

    expect(mocks.pruneImportJobs).toHaveBeenCalledWith(db);
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "import_jobs.pruned", deleted: 4 }),
    );

    mocks.pruneImportJobs.mockRejectedValue(new TypeError("no table"));
    mocks.refreshNextEpisodes.mockClear();
    await expect(runTvmazeJobs()).resolves.toBeUndefined();
    expect(mocks.refreshNextEpisodes).toHaveBeenCalled();
  });

  it("still looks for the episodes when deleting the records fails", async () => {
    const db = { execute: vi.fn() };
    mocks.getTvmaze.mockReturnValue({});
    mocks.getDb.mockResolvedValue(db);
    mocks.prunePictureUploads.mockRejectedValue(new TypeError("no table"));
    mocks.refreshNextEpisodes.mockResolvedValue({});

    await expect(runTvmazeJobs()).resolves.toBeUndefined();

    expect(mocks.refreshNextEpisodes).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "prune-picture-uploads",
        error: "TypeError",
      }),
    );
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

describe("the third Cron Trigger (SAG-27)", () => {
  it("is declared in wrangler.jsonc next to the other two, and is not the same as either", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");

    expect(config).toContain(`"${outboxCron}"`);
    expect(config).toContain(`"${tvmazeCron}"`);
    expect(config).toContain('"0 */6 * * *"');
    expect(new Set([outboxCron, tvmazeCron, "0 */6 * * *"]).size).toBe(3);
  });

  it("is hourly, not every minute, so the database can sleep between runs", () => {
    // `15 * * * *`: minute 15 of every hour. A cron that fires every minute starts with `*`.
    expect(outboxCron).toBe("15 * * * *");
    expect(outboxCron.startsWith("*")).toBe(false);
    expect(outboxCron.split(" ")[1]).toBe("*");
  });

  it("delivers the events that are due and logs the summary", async () => {
    const db = { execute: vi.fn() };
    const summary = {
      found: 3,
      delivered: 2,
      retried: 1,
      failed: 0,
      paused: 0,
      disabled: 0,
      skipped: 0,
      errors: 0,
    };
    mocks.getWebhooksEnabled.mockReturnValue(true);
    mocks.getDb.mockResolvedValue(db);
    mocks.deliverDueEvents.mockResolvedValue(summary);

    await runOutboxJobs();

    expect(mocks.deliverDueEvents).toHaveBeenCalledWith({ db });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "webhooks.batch", ...summary }),
    );
  });

  it("leaves the database asleep, and sends nothing, when the webhooks are off", async () => {
    mocks.getWebhooksEnabled.mockReturnValue(false);

    await runOutboxJobs();

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.deliverDueEvents).not.toHaveBeenCalled();
    expect(mocks.announceNewEpisodes).not.toHaveBeenCalled();
  });

  describe("the episodes that came out (SAG-28)", () => {
    it("announces them before it delivers, so a new episode goes in the same run", async () => {
      const db = { execute: vi.fn() };
      mocks.getWebhooksEnabled.mockReturnValue(true);
      mocks.getDb.mockResolvedValue(db);
      mocks.deliverDueEvents.mockResolvedValue({ found: 0 });

      await runOutboxJobs();

      expect(mocks.announceNewEpisodes).toHaveBeenCalledWith(db);
      expect(
        mocks.announceNewEpisodes.mock.invocationCallOrder[0],
      ).toBeLessThan(mocks.deliverDueEvents.mock.invocationCallOrder[0] ?? 0);
    });

    it("opens the database once for both, since each open is a subrequest", async () => {
      mocks.getWebhooksEnabled.mockReturnValue(true);
      mocks.getDb.mockResolvedValue({ execute: vi.fn() });
      mocks.deliverDueEvents.mockResolvedValue({ found: 0 });

      await runOutboxJobs();

      expect(mocks.getDb).toHaveBeenCalledTimes(1);
    });

    it("logs how many came out and how many messages that made, and says nothing when none did", async () => {
      mocks.getWebhooksEnabled.mockReturnValue(true);
      mocks.getDb.mockResolvedValue({ execute: vi.fn() });
      mocks.deliverDueEvents.mockResolvedValue({ found: 0 });

      await runOutboxJobs();
      expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
        "episodes.announced",
      );

      mocks.announceNewEpisodes.mockResolvedValue({ episodes: 4, messages: 2 });
      await runOutboxJobs();
      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "episodes.announced",
          episodes: 4,
          messages: 2,
        }),
      );
    });

    it("logs a failure of the announcement by name and still delivers what was waiting", async () => {
      mocks.getWebhooksEnabled.mockReturnValue(true);
      mocks.getDb.mockResolvedValue({ execute: vi.fn() });
      mocks.announceNewEpisodes.mockRejectedValue(
        new TypeError('column "announced_stamp" does not exist'),
      );
      mocks.deliverDueEvents.mockResolvedValue({ found: 1 });

      await expect(runOutboxJobs()).resolves.toBeUndefined();

      expect(console.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "job.failed",
          job: "announce-episodes",
          error: "TypeError",
        }),
      );
      expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
        "announced_stamp",
      );
      expect(mocks.deliverDueEvents).toHaveBeenCalledTimes(1);
    });
  });

  it("logs a failure by name, with nothing else, and does not throw", async () => {
    mocks.getWebhooksEnabled.mockReturnValue(true);
    mocks.getDb.mockResolvedValue({ execute: vi.fn() });
    mocks.deliverDueEvents.mockRejectedValue(
      new TypeError("https://discord.com/api/webhooks/1/secret"),
    );

    await expect(runOutboxJobs()).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "job.failed",
        job: "deliver-outbox",
        error: "TypeError",
      }),
    );
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      "secret",
    );
  });

  it("does not run the jobs of the other two triggers", async () => {
    mocks.getWebhooksEnabled.mockReturnValue(false);

    await runOutboxJobs();

    expect(mocks.getMediaProviders).not.toHaveBeenCalled();
    expect(mocks.getTvmaze).not.toHaveBeenCalled();
    expect(mocks.enrichWithWikidata).not.toHaveBeenCalled();
  });
});

describe("the fourth Cron Trigger (SAG-241)", () => {
  it("is declared in wrangler.jsonc and differs from the other three", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");

    expect(config).toContain(`"${importCron}"`);
    expect(
      new Set([importCron, outboxCron, tvmazeCron, "0 */6 * * *"]).size,
    ).toBe(4);
  });

  it("never fires at the same minute as the hourly one or the 6 hourly ones", () => {
    const minutes = importCron.split(" ")[0]?.split(",") ?? [];
    expect(minutes).toEqual(["5", "20", "35", "50"]);
    expect(minutes).not.toContain("15");
    expect(minutes).not.toContain("0");
    expect(minutes).not.toContain("30");
  });

  it("saves the waiting titles and logs the summary only when it took some", async () => {
    const db = { execute: vi.fn() };
    const providers = [{ id: "tmdb" }];
    mocks.getMediaProviders.mockReturnValue(providers);
    mocks.getDb.mockResolvedValue(db);
    mocks.processImportBatch.mockResolvedValue({ taken: 0 });

    await runImportJobs();

    expect(mocks.processImportBatch).toHaveBeenCalledWith({ db, providers });
    expect(console.log).not.toHaveBeenCalled();

    mocks.processImportBatch.mockResolvedValue({ taken: 3, added: 2 });
    await runImportJobs();
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "imports.batch", taken: 3, added: 2 }),
    );
  });

  it("leaves the database asleep without a provider, and never throws", async () => {
    mocks.getMediaProviders.mockReturnValue([]);
    await runImportJobs();
    expect(mocks.getDb).not.toHaveBeenCalled();

    mocks.getMediaProviders.mockReturnValue([{ id: "tmdb" }]);
    mocks.getDb.mockRejectedValue(new TypeError("down"));
    await expect(runImportJobs()).resolves.toBeUndefined();
  });
});

describe("jobsForCron (SAG-27)", () => {
  it("gives each Cron Trigger its own job, told apart by the string it fired with", () => {
    expect(jobsForCron("0 */6 * * *")).toBe(runScheduledJobs);
    expect(jobsForCron(tvmazeCron)).toBe(runTvmazeJobs);
    expect(jobsForCron(outboxCron)).toBe(runOutboxJobs);
    expect(jobsForCron(importCron)).toBe(runImportJobs);
  });

  it("runs the jobs of the first trigger for a string it does not know, as before", () => {
    expect(jobsForCron("* * * * *")).toBe(runScheduledJobs);
    expect(jobsForCron("")).toBe(runScheduledJobs);
  });
});
