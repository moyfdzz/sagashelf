import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "../../testing/msw";
import { tmdbBase, tmdbHandlers, type SeenRequest } from "../../testing/tmdb";
import { createTmdbProviderWithToken } from ".";

// No pauses between retries, so the tests are quick.
const fast = { sleep: async () => undefined, retries: 1 };

function setup(seen: SeenRequest[] = []) {
  mswServer.use(...tmdbHandlers(seen));
  return createTmdbProviderWithToken("demo-token", fast);
}

describe("the TMDB provider (contract)", () => {
  it("says what it covers and what it must show", () => {
    const provider = setup();

    expect(provider.id).toBe("tmdb");
    expect(provider.capabilities).toEqual({
      types: ["movie", "series", "anime"],
      parts: true,
      trending: true,
    });
    expect(provider.attribution.notice).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
  });

  it("searches movies and series together and tells anime apart", async () => {
    const provider = setup();

    const items = await provider.search("titan", { locale: "es" });

    expect(items.map((item) => [item.title, item.type])).toEqual([
      ["Matrix", "movie"],
      ["Your Name.", "anime"],
      ["Breaking Bad", "series"],
      ["Ataque a los Titanes", "anime"],
      ["Rick y Morty", "series"],
    ]);
  });

  it("filters by type: anime keeps the anime of both endpoints", async () => {
    const provider = setup();

    const anime = await provider.search("x", { type: "anime", locale: "es" });
    const series = await provider.search("x", { type: "series", locale: "es" });

    expect(anime.map((item) => item.title)).toEqual([
      "Your Name.",
      "Ataque a los Titanes",
    ]);
    expect(series.map((item) => item.title)).toEqual([
      "Breaking Bad",
      "Rick y Morty",
    ]);
  });

  it("asks only the movie endpoint for movies and only the series one for series", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    await provider.search("x", { type: "movie", locale: "en" });
    await provider.search("x", { type: "series", locale: "en" });

    expect(seen.map((request) => request.url.pathname)).toEqual([
      "/3/search/movie",
      "/3/search/tv",
    ]);
  });

  it("sends the token in a header, the language and no adult results", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    await provider.search("la matrix", { type: "movie", locale: "es" });
    await provider.search("the matrix", { type: "movie", locale: "en" });

    expect(seen[0].headers.get("authorization")).toBe("Bearer demo-token");
    expect(seen[0].headers.get("user-agent")).toContain("SagaShelf");
    expect(seen[0].url.searchParams.get("query")).toBe("la matrix");
    expect(seen[0].url.searchParams.get("language")).toBe("es-MX");
    expect(seen[1].url.searchParams.get("language")).toBe("en-US");
    expect(seen[0].url.searchParams.get("include_adult")).toBe("false");
    // The token is never in the address.
    expect(seen[0].url.toString()).not.toContain("demo-token");
  });

  it("does not call TMDB for an empty query", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    expect(await provider.search("   ", { locale: "es" })).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("encodes the query so it cannot add parameters", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    await provider.search("a&api_key=stolen#x", {
      type: "movie",
      locale: "es",
    });

    expect(seen[0].url.searchParams.get("query")).toBe("a&api_key=stolen#x");
    expect(seen[0].url.searchParams.get("api_key")).toBeNull();
  });

  it("gets one title by its id, with its status", async () => {
    const provider = setup();

    const item = await provider.getById("movie/603", { locale: "es" });

    expect(item).toMatchObject({
      title: "Matrix",
      type: "movie",
      status: "finished",
      externalId: { provider: "tmdb", id: "movie/603" },
    });
  });

  it("answers null for a title that does not exist or an id that is not ours", async () => {
    const provider = setup();

    expect(await provider.getById("movie/999999", { locale: "es" })).toBeNull();
    expect(await provider.getById("nonsense", { locale: "es" })).toBeNull();
  });

  it("lists seasons and episodes of a series, and none for a movie", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    const parts = await provider.getParts("tv/1429");

    expect(parts.filter((part) => part.kind === "season")).toHaveLength(3);
    expect(parts.filter((part) => part.kind === "episode")).toEqual([
      expect.objectContaining({ number: 1, seasonNumber: 0 }),
      expect.objectContaining({ number: 1, seasonNumber: 1 }),
      expect.objectContaining({ number: 2, seasonNumber: 1 }),
      expect.objectContaining({ number: 1, seasonNumber: 2 }),
    ]);
    // One call for the series and one for all three seasons.
    expect(seen).toHaveLength(2);
    expect(seen[1].url.searchParams.get("append_to_response")).toBe(
      "season/0,season/1,season/2",
    );
    expect(await provider.getParts("movie/603")).toEqual([]);
  });

  it("reads trending titles and leaves people out", async () => {
    const provider = setup();

    const all = await provider.trending?.("week", { locale: "es" });
    const anime = await provider.trending?.("day", {
      type: "anime",
      locale: "es",
    });

    expect(all?.map((item) => item.title)).toEqual([
      "Matrix",
      "Ataque a los Titanes",
    ]);
    expect(anime?.map((item) => item.title)).toEqual(["Ataque a los Titanes"]);
  });
});

describe("when TMDB has a problem", () => {
  it("fails with a ProviderError that carries no secret", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/search/movie`, () =>
        HttpResponse.json({ status_message: "demo-token" }, { status: 500 }),
      ),
    );
    const provider = createTmdbProviderWithToken("demo-token", fast);

    const error = await provider
      .search("x", { type: "movie", locale: "es" })
      .catch((caught: Error) => caught);

    expect(error).toMatchObject({ name: "ProviderError", status: 500 });
    expect((error as Error).message).not.toContain("demo-token");
  });

  it("still answers with the series when the movie endpoint is down", async () => {
    // The first handler that matches wins, so the outage goes first.
    mswServer.use(
      http.get(`${tmdbBase}/search/movie`, () =>
        HttpResponse.json({}, { status: 503 }),
      ),
      ...tmdbHandlers(),
    );
    const provider = createTmdbProviderWithToken("demo-token", fast);

    const items = await provider.search("x", { locale: "es" });

    expect(items.map((item) => item.title)).toEqual([
      "Breaking Bad",
      "Ataque a los Titanes",
      "Rick y Morty",
    ]);
  });

  it("fails when both endpoints are down", async () => {
    mswServer.use(
      http.get(`${tmdbBase}/search/:kind`, () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    const provider = createTmdbProviderWithToken("demo-token", fast);

    await expect(provider.search("x", { locale: "es" })).rejects.toMatchObject({
      name: "ProviderError",
    });
  });
});
