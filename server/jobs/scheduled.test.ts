import { beforeEach, describe, expect, it, vi } from "vitest";

import { runScheduledJobs } from "./scheduled";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getMediaProviders: vi.fn(),
  refreshStaleMedia: vi.fn(),
}));

vi.mock("../runtime-env", () => ({
  getDb: mocks.getDb,
  getMediaProviders: mocks.getMediaProviders,
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
});
