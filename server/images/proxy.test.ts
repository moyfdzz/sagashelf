import { describe, expect, it, vi } from "vitest";

import { maxImageBytes, serveImage } from "./proxy";

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

const jpeg = (body = "image-bytes", headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "Content-Type": "image/jpeg", ...headers } });

function deps(overrides: {
  fetch?: typeof fetch;
  cache?: Cache | null;
  allow?: () => Promise<boolean>;
}) {
  return {
    cache: overrides.cache ?? null,
    allow: overrides.allow ?? (async () => true),
    fetch: overrides.fetch ?? (async () => jpeg()),
  };
}

describe("serveImage", () => {
  it("fetches the image from the provider and sends it with a day of cache", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jpeg("poster"));

    const response = await serveImage(
      deps({ fetch: fetcher }),
      "tmdb",
      "w342",
      "a.jpg",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).toBe("poster");
    const [address, init] = fetcher.mock.calls[0] ?? [];
    expect(address).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
    // The request carries nothing of the visitor, and a redirect is not followed.
    expect(init).toMatchObject({ redirect: "manual" });
    expect(init?.headers).toBeUndefined();
  });

  it("never calls the provider for a request that is not on the list", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const allow = vi.fn(async () => true);

    for (const [provider, size, file] of [
      ["evil", "w342", "a.jpg"],
      ["tmdb", "w1", "a.jpg"],
      ["tmdb", "w342", "../../etc/passwd"],
    ] as const) {
      const response = await serveImage(
        deps({ fetch: fetcher, allow }),
        provider,
        size,
        file,
      );
      expect(response.status).toBe(404);
    }

    expect(fetcher).not.toHaveBeenCalled();
    // A refused request does not use up the limit either.
    expect(allow).not.toHaveBeenCalled();
  });

  it("answers from the cache without calling the provider or counting against the limit", async () => {
    const { cache } = fakeCache();
    const fetcher = vi.fn<typeof fetch>(async () => jpeg());
    const allow = vi.fn(async () => true);
    const options = deps({ cache, fetch: fetcher, allow });

    await serveImage(options, "tmdb", "w185", "a.jpg");
    const second = await serveImage(options, "tmdb", "w185", "a.jpg");

    expect(second.status).toBe(200);
    expect(second.headers.get("Cache-Control")).toBe("public, max-age=86400");
    // A copy whose headers can be changed: the Worker adds the security headers to it.
    expect(() => second.headers.set("X-Test", "1")).not.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(allow).toHaveBeenCalledTimes(1);
  });

  it("keeps a copy for each size apart", async () => {
    const { cache, store } = fakeCache();

    await serveImage(deps({ cache }), "tmdb", "w185", "a.jpg");
    await serveImage(deps({ cache }), "tmdb", "w342", "a.jpg");

    expect(store.size).toBe(2);
  });

  it("answers 429 when the limit is used up, and keeps nothing", async () => {
    const { cache, spy } = fakeCache();
    const fetcher = vi.fn<typeof fetch>();

    const response = await serveImage(
      deps({ cache, fetch: fetcher, allow: async () => false }),
      "tmdb",
      "w342",
      "a.jpg",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(fetcher).not.toHaveBeenCalled();
    expect(spy.put).not.toHaveBeenCalled();
  });

  it("answers 404 when the provider has no such image, and does not keep the failure", async () => {
    const { cache, spy } = fakeCache();

    const response = await serveImage(
      deps({ cache, fetch: async () => new Response(null, { status: 404 }) }),
      "tmdb",
      "w342",
      "gone.jpg",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(spy.put).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a redirect to another host",
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/a.jpg" },
        }),
    ],
    ["a provider error", async () => new Response("oops", { status: 500 })],
    [
      "something that is not an image",
      async () =>
        new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    ],
    [
      "an image type we do not serve",
      async () =>
        new Response("<svg/>", {
          headers: { "Content-Type": "image/svg+xml" },
        }),
    ],
    ["an empty body", async () => jpeg("")],
    [
      "a size announced as too big",
      async () => jpeg("x", { "Content-Length": String(maxImageBytes + 1) }),
    ],
    [
      "a body that is too big without announcing it",
      async () => jpeg("x".repeat(maxImageBytes + 1)),
    ],
    [
      "a network failure",
      async () => {
        throw new TypeError("network");
      },
    ],
  ])("answers 502 for %s", async (_name, fetcher) => {
    const response = await serveImage(
      deps({ fetch: fetcher as typeof fetch }),
      "tmdb",
      "w342",
      "a.jpg",
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("still answers when the cache does not work", async () => {
    const broken = {
      match: async () => {
        throw new Error("cache down");
      },
      put: async () => {
        throw new Error("cache down");
      },
    } as unknown as Cache;

    const response = await serveImage(
      deps({ cache: broken }),
      "tmdb",
      "w342",
      "a.jpg",
    );

    expect(response.status).toBe(200);
  });
});
