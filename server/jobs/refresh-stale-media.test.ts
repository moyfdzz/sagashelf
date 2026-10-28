import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshBatchSize, refreshStaleMedia } from "./refresh-stale-media";
import { createTmdbProviderWithToken } from "../providers/tmdb";
import { mswServer } from "../testing/msw";
import { tmdbBase, tmdbHandlers, type SeenRequest } from "../testing/tmdb";

const mocks = vi.hoisted(() => ({
  findMediaToRefresh: vi.fn(),
  markRefreshAttempt: vi.fn(),
  saveMedia: vi.fn(),
  saveParts: vi.fn(),
}));

vi.mock("../db/media-store", () => mocks);

const db = { execute: vi.fn() };
// No pauses between retries, so the failing provider answers quickly.
const provider = () =>
  createTmdbProviderWithToken("demo-token", {
    sleep: async () => undefined,
    retries: 0,
  });

const row = (externalId: string, mediaId = `media-${externalId}`) => ({
  mediaId,
  provider: "tmdb",
  externalId,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveMedia.mockImplementation(async () => "saved-id");
  mocks.markRefreshAttempt.mockResolvedValue(undefined);
  mocks.saveParts.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("refreshStaleMedia", () => {
  it("asks for each title in both languages and saves them, with the seasons of a series", async () => {
    const seen: SeenRequest[] = [];
    mswServer.use(...tmdbHandlers(seen));
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/603"),
      row("tv/1429"),
    ]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 2, refreshed: 2, failed: 0 });
    expect(mocks.findMediaToRefresh).toHaveBeenCalledWith(db, refreshBatchSize);
    // English first, so the title column ends in Spanish.
    expect(
      mocks.saveMedia.mock.calls.map(([, media, locale]) => [
        media.externalId.id,
        locale,
      ]),
    ).toEqual([
      ["movie/603", "en"],
      ["movie/603", "es"],
      ["tv/1429", "en"],
      ["tv/1429", "es"],
    ]);
    const languages = seen
      .filter((request) => request.url.pathname.endsWith("/movie/603"))
      .map((request) => request.url.searchParams.get("language"));
    expect(languages.sort()).toEqual(["en-US", "es-MX"]);
    // A movie has no seasons (`saveParts` writes nothing for an empty list); the series does.
    expect(
      mocks.saveParts.mock.calls.map(([, id, parts]) => [id, parts.length > 0]),
    ).toEqual([
      ["saved-id", false],
      ["saved-id", true],
    ]);
  });

  it("does nothing, and asks for nothing, on an empty run", async () => {
    const seen: SeenRequest[] = [];
    mswServer.use(...tmdbHandlers(seen));
    mocks.findMediaToRefresh.mockResolvedValue([]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 0, refreshed: 0, failed: 0 });
    expect(seen).toEqual([]);
    expect(mocks.saveMedia).not.toHaveBeenCalled();
  });

  it("does not even read the database when there is no provider", async () => {
    const summary = await refreshStaleMedia({ db, providers: [] });

    expect(summary).toEqual({ found: 0, refreshed: 0, failed: 0 });
    expect(mocks.findMediaToRefresh).not.toHaveBeenCalled();
  });

  it("keeps going when the provider fails on one title, and notes the attempt", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/movie/500`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
      ...tmdbHandlers(),
    );
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/500", "broken"),
      row("movie/603", "fine"),
    ]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 2, refreshed: 1, failed: 1 });
    expect(mocks.markRefreshAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.markRefreshAttempt).toHaveBeenCalledWith(db, "broken");
    expect(
      mocks.saveMedia.mock.calls.every(
        ([, media]) => media.externalId.id === "movie/603",
      ),
    ).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"media.refresh_failed"'),
    );
  });

  it("saves nothing of a title the provider no longer knows, and tries it again later", async () => {
    mswServer.use(...tmdbHandlers());
    mocks.findMediaToRefresh.mockResolvedValue([row("movie/999999", "gone")]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 1, refreshed: 0, failed: 1 });
    expect(mocks.saveMedia).not.toHaveBeenCalled();
    expect(mocks.markRefreshAttempt).toHaveBeenCalledWith(db, "gone");
  });

  it("still finishes the batch when noting the attempt fails too", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/movie/500`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
      ...tmdbHandlers(),
    );
    mocks.markRefreshAttempt.mockRejectedValue(new Error("db down"));
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/500"),
      row("movie/603"),
    ]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 2, refreshed: 1, failed: 1 });
  });

  it("keeps a title whose seasons could not be fetched", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/tv/1429`, ({ request }) =>
        new URL(request.url).searchParams.has("append_to_response")
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json({
              id: 1429,
              name: "Ataque a los Titanes",
              original_name: "進撃の巨人",
              overview: "Sinopsis",
              first_air_date: "2013-04-07",
              origin_country: ["JP"],
              genre_ids: [16],
              seasons: [{ season_number: 1, name: "Temporada 1" }],
            }),
      ),
    );
    mocks.findMediaToRefresh.mockResolvedValue([row("tv/1429")]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 1, refreshed: 1, failed: 0 });
    expect(mocks.saveMedia).toHaveBeenCalledTimes(2);
    expect(mocks.markRefreshAttempt).not.toHaveBeenCalled();
  });

  it("skips a title whose source is not available in this deployment", async () => {
    mswServer.use(...tmdbHandlers());
    mocks.findMediaToRefresh.mockResolvedValue([
      { mediaId: "x", provider: "mangadex", externalId: "abc" },
    ]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 1, refreshed: 0, failed: 0 });
    expect(mocks.saveMedia).not.toHaveBeenCalled();
  });
});
