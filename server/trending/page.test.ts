import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteFavorites } from "../db/site-favorites";
import type { MediaProvider } from "../providers/types";
import {
  favoritesTtlSeconds,
  getCachedSiteFavorites,
  loadTrendingPage,
} from "./page";

const mocks = vi.hoisted(() => ({ getSiteFavorites: vi.fn() }));

vi.mock("../db/site-favorites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/site-favorites")>()),
  getSiteFavorites: mocks.getSiteFavorites,
}));

/** A cache that keeps what it is given in memory, like the Workers one. */
function fakeCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      store.set(request.url, response);
    }),
  };
  return { cache: cache as unknown as Cache, store, spy: cache };
}

const db = { execute: vi.fn() };
const january = { from: "2026-01-01", to: "2026-02-01" };
const february = { from: "2026-02-01", to: "2026-03-01" };

const favorites = (title: string): SiteFavorites => ({
  mostAdded: [
    {
      mediaId: "m1",
      title,
      type: "movie",
      year: 2020,
      imageUrl: null,
      people: 3,
      average: null,
    },
  ],
  mostCompleted: [],
  bestRated: [],
});

beforeEach(() => {
  mocks.getSiteFavorites.mockReset().mockResolvedValue(favorites("Dune"));
});

describe("the favorites of the site with a copy at the edge (SAG-23)", () => {
  it("asks the database once for an hour of identical requests", async () => {
    const { cache, spy } = fakeCache();

    const first = await getCachedSiteFavorites(
      db,
      cache,
      "movie",
      january,
      "es",
    );
    const second = await getCachedSiteFavorites(
      db,
      cache,
      "movie",
      january,
      "es",
    );

    expect(second).toEqual(first);
    expect(mocks.getSiteFavorites).toHaveBeenCalledTimes(1);
    expect(mocks.getSiteFavorites).toHaveBeenCalledWith(
      db,
      "movie",
      january,
      "es",
    );
    expect(spy.put.mock.calls[0]?.[1].headers.get("Cache-Control")).toBe(
      "public, max-age=3600",
    );
    expect(favoritesTtlSeconds).toBe(3600);
  });

  it("keeps one copy for each type, period and language", async () => {
    const { cache } = fakeCache();
    const ask = (
      type: "movie" | "series",
      period = january,
      locale: "es" | "en" = "es",
    ) => getCachedSiteFavorites(db, cache, type, period, locale);

    await ask("movie");
    await ask("series");
    await ask("movie", february);
    await ask("movie", january, "en");
    expect(mocks.getSiteFavorites).toHaveBeenCalledTimes(4);

    await ask("movie");
    await ask("movie", january, "en");
    expect(mocks.getSiteFavorites).toHaveBeenCalledTimes(4);
  });

  it("keeps a separate copy for two periods that end the same day", async () => {
    const { cache } = fakeCache();
    const week = { from: "2026-11-06", to: "2026-11-13" };
    const month = { from: "2026-10-14", to: "2026-11-13" };

    await getCachedSiteFavorites(db, cache, "movie", week, "es");
    await getCachedSiteFavorites(db, cache, "movie", month, "es");

    expect(mocks.getSiteFavorites).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure of the database", async () => {
    const { cache, store } = fakeCache();
    mocks.getSiteFavorites.mockRejectedValueOnce(new Error("database is down"));

    await expect(
      getCachedSiteFavorites(db, cache, "movie", january, "es"),
    ).rejects.toThrow("database is down");

    expect(store.size).toBe(0);
  });

  it("reads a copy in a wrong shape as a miss, whichever list is wrong", async () => {
    const { cache, store } = fakeCache();
    await getCachedSiteFavorites(db, cache, "movie", january, "es");
    const [key] = [...store.keys()];
    const whole = { mostAdded: [], mostCompleted: [], bestRated: [] };
    const wrong = [
      { ...whole, mostAdded: "nope" },
      { ...whole, mostCompleted: "nope" },
      { ...whole, bestRated: "nope" },
      { mostAdded: [], mostCompleted: [] },
      null,
    ];

    for (const [index, body] of wrong.entries()) {
      store.set(key ?? "", new Response(JSON.stringify(body)));
      await getCachedSiteFavorites(db, cache, "movie", january, "es");
      expect(mocks.getSiteFavorites).toHaveBeenCalledTimes(2 + index);
    }
  });
});

describe("the whole trending page (SAG-23)", () => {
  const provider = {
    id: "tmdb",
    capabilities: { types: ["movie"], parts: true, trending: true },
    attribution: {
      name: "TMDB",
      url: "https://www.themoviedb.org",
      notice: "n",
    },
    trending: vi.fn(async () => []),
  } as unknown as MediaProvider;

  it("gives the favorites of the period and the worldwide list of the week", async () => {
    const { cache } = fakeCache();

    const page = await loadTrendingPage({
      db,
      cache,
      providers: [provider],
      type: "movie",
      period: january,
      locale: "en",
    });

    expect(page.favorites.mostAdded[0]?.title).toBe("Dune");
    expect(page.worldwide).toMatchObject({ status: "ok", titles: [] });
    expect(provider.trending).toHaveBeenCalledWith(
      "week",
      expect.objectContaining({ type: "movie", locale: "en" }),
    );
  });

  it("still shows the favorites when the worldwide list is not available", async () => {
    const failing = {
      ...provider,
      trending: vi.fn(async () => {
        throw new Error("TMDB is down");
      }),
    } as unknown as MediaProvider;

    const page = await loadTrendingPage({
      db,
      cache: null,
      providers: [failing],
      type: "movie",
      period: january,
      locale: "es",
    });

    expect(page.worldwide).toEqual({ status: "unavailable" });
    expect(page.favorites.mostAdded).toHaveLength(1);
  });

  it("has no worldwide list for a book, and does not call a source for it", async () => {
    const calls = vi.fn();
    const page = await loadTrendingPage({
      db,
      cache: null,
      providers: [{ ...provider, trending: calls } as unknown as MediaProvider],
      type: "book",
      period: january,
      locale: "es",
    });

    expect(page.worldwide).toEqual({ status: "unsupported" });
    expect(calls).not.toHaveBeenCalled();
  });
});
