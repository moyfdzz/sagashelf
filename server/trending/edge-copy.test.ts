import { describe, expect, it, vi } from "vitest";

import { edgeKey, withEdgeCopy } from "./edge-copy";

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

const list = (body: unknown) =>
  Array.isArray(body) ? (body as number[]) : null;
const key = edgeKey("test", "v1", { a: "1" });

describe("a copy at the edge (SAG-23)", () => {
  it("loads once, keeps the answer for the seconds asked and then gives the copy", async () => {
    const { cache, spy } = fakeCache();
    const load = vi.fn(async () => [1, 2]);
    const ask = () =>
      withEdgeCopy({ cache, key, seconds: 123, parse: list, load });

    expect(await ask()).toEqual([1, 2]);
    expect(await ask()).toEqual([1, 2]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(spy.put.mock.calls[0]?.[1].headers.get("Cache-Control")).toBe(
      "public, max-age=123",
    );
  });

  it("keeps an empty answer too", async () => {
    const { cache } = fakeCache();
    const load = vi.fn(async () => [] as number[]);
    const ask = () =>
      withEdgeCopy({ cache, key, seconds: 60, parse: list, load });

    await ask();
    await ask();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failure and lets it reach the caller", async () => {
    const { cache, store } = fakeCache();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("the source is down"))
      .mockResolvedValueOnce([3]);
    const ask = () =>
      withEdgeCopy({ cache, key, seconds: 60, parse: list, load });

    await expect(ask()).rejects.toThrow("the source is down");
    expect(store.size).toBe(0);
    expect(await ask()).toEqual([3]);
  });

  it("keeps a copy for each address", async () => {
    const { cache } = fakeCache();
    const load = vi.fn(async () => [1]);
    const ask = (name: string) =>
      withEdgeCopy({
        cache,
        key: edgeKey("test", "v1", { name }),
        seconds: 60,
        parse: list,
        load,
      });

    await ask("a");
    await ask("b");
    await ask("a");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("builds an address that names the list, the version and every part", () => {
    expect(edgeKey("trending", "v2", { type: "movie", locale: "es" }).url).toBe(
      "https://trending-cache.sagashelf.internal/v2?type=movie&locale=es",
    );
    // A value cannot add a parameter of its own.
    expect(edgeKey("x", "v1", { q: "a&b=c" }).url).toBe(
      "https://x-cache.sagashelf.internal/v1?q=a%26b%3Dc",
    );
  });

  it("reads a copy that parse refuses as a miss, and replaces it", async () => {
    const { cache, store } = fakeCache();
    store.set(key.url, new Response(JSON.stringify({ not: "a list" })));
    const load = vi.fn(async () => [9]);

    const answer = await withEdgeCopy({
      cache,
      key,
      seconds: 60,
      parse: list,
      load,
    });

    expect(answer).toEqual([9]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("works with no cache and with a cache that throws", async () => {
    const load = vi.fn(async () => [1]);
    const broken = {
      match: vi.fn(async () => {
        throw new Error("no cache here");
      }),
      put: vi.fn(async () => {
        throw new Error("no cache here");
      }),
    } as unknown as Cache;

    expect(
      await withEdgeCopy({ cache: null, key, seconds: 60, parse: list, load }),
    ).toEqual([1]);
    expect(
      await withEdgeCopy({
        cache: broken,
        key,
        seconds: 60,
        parse: list,
        load,
      }),
    ).toEqual([1]);
  });
});
