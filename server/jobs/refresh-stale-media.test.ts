import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshBatchSize, refreshStaleMedia } from "./refresh-stale-media";
import { createTmdbProviderWithToken } from "../providers/tmdb";
import { mswServer } from "../testing/msw";
import { tmdbBase, tmdbHandlers, type SeenRequest } from "../testing/tmdb";

const mocks = vi.hoisted(() => ({
  findMediaToRefresh: vi.fn(),
  markRefreshAttempt: vi.fn(),
  removeProviderData: vi.fn(),
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

const row = (
  externalId: string,
  mediaId = `media-${externalId}`,
  stale = false,
) => ({
  mediaId,
  provider: "tmdb",
  externalId,
  stale,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveMedia.mockImplementation(async () => "saved-id");
  mocks.markRefreshAttempt.mockResolvedValue(undefined);
  mocks.removeProviderData.mockResolvedValue(undefined);
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
    expect(mocks.findMediaToRefresh).toHaveBeenCalledWith(
      db,
      refreshBatchSize,
      ["tmdb"],
    );
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

  it("marks a title fresh only with the last language it saves (SAG-182)", async () => {
    mswServer.use(...tmdbHandlers());
    mocks.findMediaToRefresh.mockResolvedValue([row("movie/603")]);

    await refreshStaleMedia({ db, providers: [provider()] });

    expect(mocks.saveMedia.mock.calls.map((call) => call[3])).toEqual([
      false,
      true,
    ]);
  });

  it("stops before a title that no longer fits in the subrequest budget (SAG-182)", async () => {
    mswServer.use(...tmdbHandlers());
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/603"),
      row("movie/604"),
      row("movie/605"),
    ]);

    // One title spends 1 (the list) + 2 provider calls + 2 saves = 5, and the next one needs 12 free.
    const summary = await refreshStaleMedia(
      { db, providers: [provider()] },
      refreshBatchSize,
      16,
    );

    expect(summary).toEqual({ found: 3, refreshed: 1, failed: 0 });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"media.refresh_budget"'),
    );
  });

  it("counts the retries of a failing provider against the budget (SAG-182)", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/movie/500`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
      ...tmdbHandlers(),
    );
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/500", "broken"),
      row("movie/603"),
    ]);
    const retrying = createTmdbProviderWithToken("demo-token", {
      sleep: async () => undefined,
      retries: 2,
    });

    // Two languages x 3 tries = 6 calls + the list + the note = 8: the second title no longer fits.
    const summary = await refreshStaleMedia(
      { db, providers: [retrying] },
      refreshBatchSize,
      19,
    );

    expect(summary).toEqual({ found: 2, refreshed: 0, failed: 1 });
  });

  it("asks the store only for the providers that are on (SAG-179)", async () => {
    mocks.findMediaToRefresh.mockResolvedValue([]);

    await refreshStaleMedia({ db, providers: [provider()] }, 3);

    expect(mocks.findMediaToRefresh).toHaveBeenCalledWith(db, 3, ["tmdb"]);
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
    expect(mocks.removeProviderData).not.toHaveBeenCalled();
  });

  it("removes what TMDB sent for a title it no longer knows once it is past 150 days (SAG-180)", async () => {
    mswServer.use(...tmdbHandlers());
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/999999", "gone", true),
    ]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 1, refreshed: 0, failed: 1 });
    expect(mocks.removeProviderData).toHaveBeenCalledWith(db, "gone");
    expect(mocks.markRefreshAttempt).not.toHaveBeenCalled();
    expect(mocks.saveMedia).not.toHaveBeenCalled();
  });

  it("notes the attempt, and keeps the data, when the removal fails (SAG-180)", async () => {
    mswServer.use(...tmdbHandlers());
    mocks.removeProviderData.mockRejectedValue(new Error("db down"));
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/999999", "gone", true),
    ]);

    const summary = await refreshStaleMedia({ db, providers: [provider()] });

    expect(summary).toEqual({ found: 1, refreshed: 0, failed: 1 });
    expect(mocks.markRefreshAttempt).toHaveBeenCalledWith(db, "gone");
  });

  it("removes nothing when TMDB fails with an error that is not a 404, even past 150 days (SAG-180)", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/movie/500`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
      ...tmdbHandlers(),
    );
    mocks.findMediaToRefresh.mockResolvedValue([
      row("movie/500", "down", true),
    ]);

    await refreshStaleMedia({ db, providers: [provider()] });

    expect(mocks.removeProviderData).not.toHaveBeenCalled();
    expect(mocks.markRefreshAttempt).toHaveBeenCalledWith(db, "down");
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
