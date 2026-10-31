import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../providers/http";
import { refreshNextEpisodes, showsPerRun } from "./refresh-next-episodes";

const mocks = vi.hoisted(() => ({
  findShowsToCheck: vi.fn(),
  saveNextEpisodes: vi.fn(),
  postponeShows: vi.fn(),
}));

vi.mock("../db/next-episodes", () => ({
  findShowsToCheck: mocks.findShowsToCheck,
  saveNextEpisodes: mocks.saveNextEpisodes,
  postponeShows: mocks.postponeShows,
}));

const db = { execute: vi.fn() };
const now = () => new Date("2026-11-01T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

const show = (id: number) => ({ mediaId: `media-${id}`, tvmazeId: id });

const running = {
  status: "Running",
  next: {
    airDate: "2026-11-04",
    airStamp: "2026-11-05T01:00:00.000Z",
    season: 2,
    number: 7,
    name: "Seven",
  },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("refreshNextEpisodes (SAG-90)", () => {
  it("asks TVmaze about each show that is due and saves every answer in one statement", async () => {
    mocks.findShowsToCheck.mockResolvedValue([show(1), show(2), show(3)]);
    const tvmaze = {
      getShow: vi
        .fn()
        .mockResolvedValueOnce(running)
        .mockResolvedValueOnce({ status: "Ended", next: null })
        .mockResolvedValueOnce(null),
    };

    const summary = await refreshNextEpisodes({ db, tvmaze }, 20, now);

    expect(summary).toEqual({
      found: 3,
      saved: 3,
      withNext: 1,
      failed: 0,
      stopped: false,
    });
    expect(mocks.findShowsToCheck).toHaveBeenCalledWith(db, 20);
    expect(tvmaze.getShow.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
    expect(mocks.saveNextEpisodes).toHaveBeenCalledTimes(1);
    const saved = mocks.saveNextEpisodes.mock.calls[0]?.[1];
    expect(saved[0]).toMatchObject({
      mediaId: "media-1",
      tvmazeId: 1,
      showStatus: "Running",
      airDate: "2026-11-04",
      season: 2,
      number: 7,
      episodeName: "Seven",
      // The day after the episode, at noon.
      nextCheckAt: new Date("2026-11-05T12:00:00Z"),
    });
    // A show that is over is asked about in three months, one TVmaze lost too.
    expect(saved[1]).toMatchObject({
      showStatus: "Ended",
      airDate: null,
      nextCheckAt: new Date(now().getTime() + 90 * day),
    });
    expect(saved[2]).toMatchObject({
      showStatus: null,
      airDate: null,
      nextCheckAt: new Date(now().getTime() + 90 * day),
    });
  });

  it("does nothing, and asks nobody, when no show is due", async () => {
    mocks.findShowsToCheck.mockResolvedValue([]);
    const tvmaze = { getShow: vi.fn() };

    const summary = await refreshNextEpisodes({ db, tvmaze }, 20, now);

    expect(summary).toMatchObject({ found: 0, saved: 0 });
    expect(tvmaze.getShow).not.toHaveBeenCalled();
    // The saves are asked with nothing, and answer without touching the database.
    expect(mocks.saveNextEpisodes).toHaveBeenCalledWith(db, []);
    expect(mocks.postponeShows).toHaveBeenCalledWith(db, [], expect.any(Date));
  });

  it("puts a show that fails off for a day, and goes on with the rest", async () => {
    mocks.findShowsToCheck.mockResolvedValue([show(1), show(2)]);
    const tvmaze = {
      getShow: vi
        .fn()
        .mockRejectedValueOnce(new ProviderError("tvmaze", "http", 500))
        .mockResolvedValueOnce(running),
    };

    const summary = await refreshNextEpisodes({ db, tvmaze }, 20, now);

    expect(summary).toMatchObject({ saved: 1, failed: 1, stopped: false });
    expect(mocks.saveNextEpisodes.mock.calls[0]?.[1]).toHaveLength(1);
    expect(mocks.postponeShows).toHaveBeenCalledWith(
      db,
      [show(1)],
      new Date(now().getTime() + day),
    );
  });

  it("stops at a 429 and never asks again in the run, saving what it already has", async () => {
    mocks.findShowsToCheck.mockResolvedValue([show(1), show(2), show(3)]);
    const tvmaze = {
      getShow: vi
        .fn()
        .mockResolvedValueOnce(running)
        .mockRejectedValueOnce(new ProviderError("tvmaze", "http", 429)),
    };

    const summary = await refreshNextEpisodes({ db, tvmaze }, 20, now);

    expect(summary).toMatchObject({ saved: 1, failed: 0, stopped: true });
    expect(tvmaze.getShow).toHaveBeenCalledTimes(2);
    expect(mocks.saveNextEpisodes.mock.calls[0]?.[1]).toHaveLength(1);
    // The show that was refused and the ones after it stay due: nothing is put off.
    expect(mocks.postponeShows).toHaveBeenCalledWith(db, [], expect.any(Date));
  });

  it("stops when the circuit is open, without counting it as a failure of the show", async () => {
    mocks.findShowsToCheck.mockResolvedValue([show(1), show(2)]);
    const tvmaze = {
      getShow: vi
        .fn()
        .mockRejectedValue(new ProviderError("tvmaze", "circuit_open")),
    };

    const summary = await refreshNextEpisodes({ db, tvmaze }, 20, now);

    expect(summary).toMatchObject({ saved: 0, failed: 0, stopped: true });
    expect(tvmaze.getShow).toHaveBeenCalledTimes(1);
  });

  it("asks for at most the number of shows it is given, 20 by default", async () => {
    mocks.findShowsToCheck.mockResolvedValue([]);

    await refreshNextEpisodes({ db, tvmaze: { getShow: vi.fn() } });

    expect(showsPerRun).toBe(20);
    expect(mocks.findShowsToCheck).toHaveBeenCalledWith(db, 20);
  });

  it("lets a failure of the database through, so the run is logged as failed", async () => {
    mocks.findShowsToCheck.mockRejectedValue(new TypeError("no table"));

    await expect(
      refreshNextEpisodes({ db, tvmaze: { getShow: vi.fn() } }),
    ).rejects.toThrow("no table");
  });
});
