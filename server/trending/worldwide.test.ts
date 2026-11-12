import { describe, expect, it, vi } from "vitest";

import { ProviderError } from "../providers/http";
import type {
  MediaKind,
  MediaProvider,
  NormalizedMedia,
} from "../providers/types";
import {
  getWorldwideTrending,
  trendingTtlSeconds,
  worldwideSize,
} from "./worldwide";

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

const item = (id: number, type: MediaKind = "movie"): NormalizedMedia => ({
  type,
  title: `Title ${id}`,
  originalTitle: `Original ${id}`,
  year: 2020 + (id % 5),
  synopsis: { es: "texto largo que la lista no guarda" },
  imageUrl: `https://image.tmdb.org/t/p/w500/${id}.jpg`,
  status: "unknown",
  popularity: id,
  externalId: { provider: "tmdb", id: `movie/${id}` },
});

function fakeProvider(
  trending: MediaProvider["trending"],
  overrides: Partial<MediaProvider> = {},
) {
  return {
    id: "tmdb",
    capabilities: {
      types: ["movie", "series", "anime"],
      parts: true,
      trending: true,
    },
    attribution: {
      name: "TMDB",
      url: "https://www.themoviedb.org",
      notice: "This product uses the TMDB API.",
    },
    trending,
    ...overrides,
  } as unknown as MediaProvider;
}

const ask = (
  providers: MediaProvider[],
  cache: Cache | null,
  extra: {
    type?: MediaKind;
    window?: "day" | "week";
    locale?: "es" | "en";
  } = {},
) =>
  getWorldwideTrending({
    providers,
    cache,
    type: extra.type ?? "movie",
    window: extra.window ?? "week",
    locale: extra.locale ?? "es",
  });

describe("the worldwide trending list (SAG-23)", () => {
  it("gives the titles with their source and logo, without the synopsis", async () => {
    const trending = vi.fn(async () => [item(1), item(2)]);

    const answer = await ask([fakeProvider(trending)], null);

    expect(answer).toEqual({
      status: "ok",
      source: {
        name: "TMDB",
        url: "https://www.themoviedb.org",
        notice: "This product uses the TMDB API.",
        logo: "/tmdb-logo.svg",
      },
      titles: [
        {
          provider: "tmdb",
          externalId: "movie/1",
          type: "movie",
          title: "Title 1",
          originalTitle: "Original 1",
          year: 2021,
          imageUrl: "https://image.tmdb.org/t/p/w500/1.jpg",
        },
        expect.objectContaining({ externalId: "movie/2" }),
      ],
    });
    expect(trending).toHaveBeenCalledWith("week", {
      type: "movie",
      locale: "es",
      signal: undefined,
    });
  });

  it("keeps the answer for an hour and asks the source once", async () => {
    const { cache, spy } = fakeCache();
    const trending = vi.fn(async () => [item(1)]);
    const providers = [fakeProvider(trending)];

    const first = await ask(providers, cache);
    const second = await ask(providers, cache);

    expect(trending).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    const kept = spy.put.mock.calls[0]?.[1];
    expect(kept?.headers.get("Cache-Control")).toBe(
      `public, max-age=${trendingTtlSeconds}`,
    );
    expect(trendingTtlSeconds).toBe(3600);
  });

  it("keeps an empty answer too, so it is not asked again for an hour", async () => {
    const { cache } = fakeCache();
    const trending = vi.fn(async () => []);

    const first = await ask([fakeProvider(trending)], cache);
    await ask([fakeProvider(trending)], cache);

    expect(first).toMatchObject({ status: "ok", titles: [] });
    expect(trending).toHaveBeenCalledTimes(1);
  });

  it("keeps one copy for each type, window and language", async () => {
    const { cache } = fakeCache();
    const trending = vi.fn(async () => [item(1)]);
    const providers = [fakeProvider(trending)];

    await ask(providers, cache, {
      type: "movie",
      window: "week",
      locale: "es",
    });
    await ask(providers, cache, {
      type: "series",
      window: "week",
      locale: "es",
    });
    await ask(providers, cache, { type: "movie", window: "day", locale: "es" });
    await ask(providers, cache, {
      type: "movie",
      window: "week",
      locale: "en",
    });
    expect(trending).toHaveBeenCalledTimes(4);

    await ask(providers, cache, {
      type: "movie",
      window: "week",
      locale: "en",
    });
    expect(trending).toHaveBeenCalledTimes(4);
  });

  it("does not keep a failure, so the next call asks again", async () => {
    const { cache, store } = fakeCache();
    const trending = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError("tmdb", "timeout"))
      .mockResolvedValueOnce([item(1)]);
    const providers = [fakeProvider(trending)];

    expect(await ask(providers, cache)).toEqual({ status: "unavailable" });
    expect(store.size).toBe(0);
    expect(await ask(providers, cache)).toMatchObject({ status: "ok" });
    expect(trending).toHaveBeenCalledTimes(2);
  });

  it("holds at most 20 titles", async () => {
    const trending = vi.fn(async () =>
      Array.from({ length: 30 }, (_, index) => item(index)),
    );

    const answer = await ask([fakeProvider(trending)], null);

    expect(answer.status === "ok" && answer.titles).toHaveLength(worldwideSize);
    expect(worldwideSize).toBe(20);
  });

  it("is unsupported for a type with no source, and never calls one", async () => {
    const trending = vi.fn(async () => [item(1)]);
    const providers = [fakeProvider(trending)];

    expect(await ask(providers, null, { type: "book" })).toEqual({
      status: "unsupported",
    });
    expect(await ask(providers, null, { type: "manga" })).toEqual({
      status: "unsupported",
    });
    expect(trending).not.toHaveBeenCalled();
  });

  it("is unsupported with no provider, or one that has no list", async () => {
    expect(await ask([], null)).toEqual({ status: "unsupported" });
    const noList = fakeProvider(undefined, {
      capabilities: { types: ["movie"], parts: true, trending: false },
    });
    expect(await ask([noList], null)).toEqual({ status: "unsupported" });
    const notDeclared = fakeProvider(undefined);
    expect(await ask([notDeclared], null)).toEqual({ status: "unsupported" });
  });

  it("does not use a source that says it has no list, even if it has the method", async () => {
    const trending = vi.fn(async () => [item(1)]);
    const saysNo = fakeProvider(trending, {
      capabilities: {
        types: ["movie"],
        parts: true,
        trending: false,
      },
    });

    expect(await ask([saysNo], null)).toEqual({ status: "unsupported" });
    expect(trending).not.toHaveBeenCalled();
  });

  it("passes the signal of the request to the source", async () => {
    const trending = vi.fn(async () => [item(1)]);
    const { signal } = new AbortController();

    await getWorldwideTrending({
      providers: [fakeProvider(trending)],
      cache: null,
      type: "movie",
      window: "day",
      locale: "en",
      signal,
    });

    expect(trending).toHaveBeenCalledWith("day", {
      type: "movie",
      locale: "en",
      signal,
    });
  });

  it("works without a cache, and with a cache that breaks", async () => {
    const trending = vi.fn(async () => [item(1)]);
    const broken = {
      match: vi.fn(async () => {
        throw new Error("no cache here");
      }),
      put: vi.fn(async () => {
        throw new Error("no cache here");
      }),
    } as unknown as Cache;

    expect(await ask([fakeProvider(trending)], null)).toMatchObject({
      status: "ok",
    });
    expect(await ask([fakeProvider(trending)], broken)).toMatchObject({
      status: "ok",
    });
  });

  it("reads a copy in a wrong shape as a miss", async () => {
    const { cache, store } = fakeCache();
    const trending = vi.fn(async () => [item(1)]);
    await ask([fakeProvider(trending)], cache);
    const [key] = [...store.keys()];
    store.set(key ?? "", new Response(JSON.stringify({ titles: "nope" })));

    await ask([fakeProvider(trending)], cache);

    expect(trending).toHaveBeenCalledTimes(2);
  });
});
