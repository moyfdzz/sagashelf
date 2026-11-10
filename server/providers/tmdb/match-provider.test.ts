import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "../../testing/msw";
import { tmdbBase } from "../../testing/tmdb";
import { matchCallsMax } from "../types";
import { createTmdbProviderWithToken } from ".";

const fast = { sleep: async () => undefined, retries: 1 };

// Animation made in Japan: what TMDB files as anime (map.ts).
const show = (id: number, name: string, year: number, anime = true) => ({
  id,
  name,
  first_air_date: `${year}-01-01`,
  genre_ids: anime ? [16] : [18],
  origin_country: [anime ? "JP" : "US"],
});

/** Searches answer by the exact query text; shows by id. Every request is written to `seen`. */
function setup(
  tv: Record<string, ReturnType<typeof show>[]>,
  details: Record<number, object>,
  movies: Record<string, object[]> = {},
) {
  const seen: string[] = [];
  mswServer.use(
    http.get(`${tmdbBase}/search/tv`, ({ request }) => {
      const query = new URL(request.url).searchParams.get("query") ?? "";
      seen.push(`search/tv ${query}`);
      return HttpResponse.json({ results: tv[query] ?? [] });
    }),
    http.get(`${tmdbBase}/search/movie`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const query = params.get("query") ?? "";
      seen.push(
        `search/movie ${query} ${params.get("primary_release_year") ?? ""}`.trim(),
      );
      return HttpResponse.json({ results: movies[query] ?? [] });
    }),
    http.get(`${tmdbBase}/tv/:id`, ({ params }) => {
      seen.push(`tv/${params.id}`);
      const found = details[Number(params.id)];
      if (found === undefined) return new HttpResponse(null, { status: 404 });
      if ("fail" in found) return new HttpResponse(null, { status: 400 });
      return HttpResponse.json(found);
    }),
  );
  return { provider: createTmdbProviderWithToken("demo-token", fast), seen };
}

const ask = (
  provider: ReturnType<typeof createTmdbProviderWithToken>,
  title: string,
  year: number,
  kind: "movie" | "tv" = "tv",
) => provider.matchByYear?.({ title, kind, year }, { locale: "es" });

describe("matchByYear of the TMDB provider (SAG-243)", () => {
  it("accepts the one series that aired in the year, though it began earlier", async () => {
    const { provider } = setup(
      { "Serie de prueba": [show(1, "Serie de prueba", 2010)] },
      { 1: { first_air_date: "2010-01-01", last_air_date: "2016-01-01" } },
    );
    expect(await ask(provider, "Serie de prueba", 2014)).toBe("tv/1");
  });

  it("looks again with the shorter title when the first search finds nothing", async () => {
    const { provider, seen } = setup(
      { "Serie de prueba": [show(1, "Serie de prueba", 2010)] },
      { 1: { first_air_date: "2010-01-01", last_air_date: "2016-01-01" } },
    );
    expect(await ask(provider, "Serie de prueba: Arco final", 2012)).toBe(
      "tv/1",
    );
    expect(seen).toEqual([
      "search/tv Serie de prueba: Arco final",
      "search/tv Serie de prueba",
      "tv/1",
    ]);
  });

  it("does not search twice when there is nothing to shorten", async () => {
    const { provider, seen } = setup({}, {});
    expect(await ask(provider, "Serie de prueba", 2012)).toBeNull();
    expect(seen).toEqual(["search/tv Serie de prueba"]);
  });

  it("answers null when two series fit, and does not try the shorter title", async () => {
    const { provider, seen } = setup(
      {
        "Serie de prueba: A": [
          show(1, "Serie de prueba", 2010),
          show(2, "Serie de prueba otra", 2011),
        ],
      },
      {
        1: { first_air_date: "2010-01-01", last_air_date: "2016-01-01" },
        2: { first_air_date: "2011-01-01", last_air_date: "2013-01-01" },
      },
    );
    expect(await ask(provider, "Serie de prueba: A", 2012)).toBeNull();
    expect(seen.filter((line) => line.startsWith("search"))).toHaveLength(1);
  });

  it("answers null when no series aired in that year", async () => {
    const { provider } = setup(
      { "Serie de prueba": [show(1, "Serie de prueba", 2010)] },
      { 1: { first_air_date: "2010-01-01", last_air_date: "2011-01-01" } },
    );
    expect(await ask(provider, "Serie de prueba", 2020)).toBeNull();
  });

  it("reads at most three candidates, so the requests stay bounded", async () => {
    const { provider, seen } = setup(
      {
        "Serie de prueba": [1, 2, 3, 4, 5].map((id) =>
          show(id, "Serie de prueba", 2000),
        ),
      },
      {},
    );
    await ask(provider, "Serie de prueba", 2020);
    expect(seen.filter((line) => line.startsWith("tv/"))).toHaveLength(3);
  });

  it("matches a movie by its release year, with no request for details", async () => {
    const { provider, seen } = setup(
      {},
      {},
      {
        "Pelicula de prueba": [
          {
            id: 7,
            title: "Pelicula de prueba",
            release_date: "2007-06-01",
            genre_ids: [16],
            original_language: "ja",
          },
          {
            id: 8,
            title: "Pelicula de prueba",
            release_date: "2024-06-01",
            genre_ids: [16],
            original_language: "ja",
          },
        ],
      },
    );
    expect(await ask(provider, "Pelicula de prueba", 2007, "movie")).toBe(
      "movie/7",
    );
    // The year goes to TMDB, so the first 3 hits are not just the most popular ones.
    expect(seen).toEqual(["search/movie Pelicula de prueba 2007"]);
  });

  it("does not call TMDB for an empty title", async () => {
    const { provider, seen } = setup({}, {});
    expect(await ask(provider, "   ", 2010)).toBeNull();
    expect(seen).toEqual([]);
  });

  it("does not accept a series that is not anime, though it aired in the year", async () => {
    const { provider } = setup(
      { "Serie de prueba": [show(1, "Serie de prueba", 2010, false)] },
      { 1: { first_air_date: "2010-01-01", last_air_date: "2016-01-01" } },
    );
    expect(await ask(provider, "Serie de prueba", 2012)).toBeNull();
  });

  it("skips a candidate that TMDB no longer has and keeps looking at the others", async () => {
    const { provider } = setup(
      {
        "Serie de prueba": [
          show(1, "Serie de prueba", 2010),
          show(2, "Serie de prueba", 2010),
        ],
      },
      { 2: { first_air_date: "2010-01-01", last_air_date: "2016-01-01" } },
    );
    expect(await ask(provider, "Serie de prueba", 2012)).toBe("tv/2");
  });

  it("fails, to be tried again, when TMDB errs on a candidate: a missing one could be the right one", async () => {
    const { provider } = setup(
      { "Serie de prueba": [show(1, "Serie de prueba", 2010)] },
      { 1: { fail: true } },
    );
    await expect(ask(provider, "Serie de prueba", 2012)).rejects.toThrow();
  });

  it("never makes more requests than matchCallsMax, the bound the queue budget counts on", async () => {
    const { provider, seen } = setup(
      {
        "Serie de prueba: A": [1, 2, 3].map((id) =>
          show(id, "Serie de prueba", 2000),
        ),
        "Serie de prueba": [4, 5, 6].map((id) =>
          show(id, "Serie de prueba", 2000),
        ),
      },
      {
        1: { first_air_date: "2000-01-01", last_air_date: "2001-01-01" },
        2: { first_air_date: "2000-01-01", last_air_date: "2001-01-01" },
        3: { first_air_date: "2000-01-01", last_air_date: "2001-01-01" },
        4: { first_air_date: "2000-01-01", last_air_date: "2001-01-01" },
        5: { first_air_date: "2000-01-01", last_air_date: "2001-01-01" },
        6: { first_air_date: "2000-01-01", last_air_date: "2001-01-01" },
      },
    );
    expect(await ask(provider, "Serie de prueba: A", 2020)).toBeNull();
    expect(seen).toHaveLength(matchCallsMax);
  });
});
