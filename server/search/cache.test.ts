import { describe, expect, it, vi } from "vitest";

import {
  cacheTtlSeconds,
  createSearchCache,
  negativeCacheTtlSeconds,
} from "./cache";
import type { SearchResult } from "./merge";

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

const dune: SearchResult = {
  id: null,
  provider: "tmdb",
  externalId: "movie/1",
  type: "movie",
  title: "Dune",
  originalTitle: null,
  year: 2021,
  synopsis: null,
  popularity: 1,
  source: "provider",
};

describe("the search cache", () => {
  it("gives back what was kept for the same query, type and language", async () => {
    const { cache } = fakeCache();
    const search = createSearchCache(cache);
    await search.put("dune", "movie", "es", { results: [dune] });

    expect(await search.get("dune", "movie", "es")).toEqual({
      results: [dune],
    });
  });

  it("keeps separate answers per type and per language", async () => {
    const { cache } = fakeCache();
    const search = createSearchCache(cache);
    await search.put("dune", "movie", "es", { results: [dune] });

    expect(await search.get("dune", "series", "es")).toBeNull();
    expect(await search.get("dune", "movie", "en")).toBeNull();
    expect(await search.get("dune", undefined, "es")).toBeNull();
  });

  it("cannot be tricked by a query that looks like another key", async () => {
    const { cache } = fakeCache();
    const search = createSearchCache(cache);
    await search.put("dune", "movie", "es", { results: [dune] });

    expect(await search.get("dune&type=movie", undefined, "es")).toBeNull();
    expect(await search.get("dune#x", "movie", "es")).toBeNull();
  });

  it("keeps an answer for a day and an empty one for an hour", async () => {
    const { cache, spy } = fakeCache();
    const search = createSearchCache(cache);

    await search.put("dune", "movie", "es", { results: [dune] });
    await search.put("zzzz", "movie", "es", { results: [] });

    const control = (call: number) =>
      (spy.put.mock.calls[call][1] as Response).headers.get("Cache-Control");
    expect(control(0)).toBe(`public, max-age=${cacheTtlSeconds}`);
    expect(control(1)).toBe(`public, max-age=${negativeCacheTtlSeconds}`);
    expect(cacheTtlSeconds).toBe(86_400);
    expect(negativeCacheTtlSeconds).toBe(3_600);
  });

  it("works as a miss when there is no cache at all", async () => {
    const search = createSearchCache(null);

    await search.put("dune", "movie", "es", { results: [dune] });

    expect(await search.get("dune", "movie", "es")).toBeNull();
  });

  it("never throws when the cache fails", async () => {
    const broken = {
      match: vi.fn(async () => {
        throw new Error("down");
      }),
      put: vi.fn(async () => {
        throw new Error("down");
      }),
    } as unknown as Cache;
    const search = createSearchCache(broken);

    await expect(
      search.put("dune", "movie", "es", { results: [dune] }),
    ).resolves.toBeUndefined();
    expect(await search.get("dune", "movie", "es")).toBeNull();
  });

  it("reads a damaged entry as a miss", async () => {
    const { cache, store } = fakeCache();
    const search = createSearchCache(cache);
    await search.put("dune", "movie", "es", { results: [dune] });
    const [key] = [...store.keys()];
    store.set(key, new Response("not json"));

    expect(await search.get("dune", "movie", "es")).toBeNull();

    store.set(key, new Response(JSON.stringify({ unexpected: true })));
    expect(await search.get("dune", "movie", "es")).toBeNull();
  });
});
