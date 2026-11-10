import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileDb } from "../db/profile";
import { lazyTotalEpisodes } from "./update-entry";

const mocks = vi.hoisted(() => ({ getSeasonCounts: vi.fn() }));

vi.mock("../db/library", () => ({
  getEntry: vi.fn(),
  saveEntry: vi.fn(),
  getSeasonCounts: mocks.getSeasonCounts,
  totalEpisodes: (seasons: { episodes: number }[]) =>
    seasons.reduce((sum, season) => sum + season.episodes, 0),
}));

const db = {} as ProfileDb;
const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

beforeEach(() => {
  mocks.getSeasonCounts.mockReset();
});

describe("lazyTotalEpisodes", () => {
  it("asks once, however many times the rule runs, and not before it is needed", async () => {
    mocks.getSeasonCounts.mockResolvedValue([{ number: 1, episodes: 4 }]);
    const episodes = lazyTotalEpisodes(db, mediaId);
    expect(mocks.getSeasonCounts).not.toHaveBeenCalled();

    expect(await episodes()).toBe(4);
    expect(await episodes()).toBe(4);

    expect(mocks.getSeasonCounts).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed read, instead of failing every try the same way", async () => {
    mocks.getSeasonCounts
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([{ number: 1, episodes: 4 }]);
    const episodes = lazyTotalEpisodes(db, mediaId);

    await expect(episodes()).rejects.toThrow("network");
    expect(await episodes()).toBe(4);
  });
});
