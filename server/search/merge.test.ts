import { describe, expect, it } from "vitest";

import {
  mergeResults,
  rankResults,
  toResult,
  type SearchResult,
} from "./merge";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: null,
    provider: "tmdb",
    externalId: "movie/1",
    type: "movie",
    title: "Dune",
    originalTitle: null,
    year: 2021,
    synopsis: null,
    imageUrl: null,
    popularity: 0,
    source: "provider",
    ...overrides,
  };
}

describe("toResult", () => {
  it("gives no synopsis when the source stored an empty one for that language", () => {
    const item = toResult(
      {
        type: "movie",
        title: "Dune",
        originalTitle: null,
        year: 2021,
        synopsis: { es: "" },
        imageUrl: null,
        status: "unknown",
        popularity: 3,
        externalId: { provider: "tmdb", id: "movie/1" },
      },
      "es",
      "local",
    );

    expect(item.synopsis).toBeNull();
  });

  it("takes the synopsis of the language that was asked for", () => {
    const item = toResult(
      {
        type: "movie",
        title: "Dune",
        originalTitle: null,
        year: 2021,
        synopsis: { es: "Arena", en: "Sand" },
        imageUrl: null,
        status: "unknown",
        popularity: 3,
        externalId: { provider: "tmdb", id: "movie/1" },
      },
      "en",
      "provider",
    );

    expect(item).toMatchObject({
      synopsis: "Sand",
      provider: "tmdb",
      externalId: "movie/1",
      id: null,
    });
  });
});

describe("mergeResults", () => {
  it("drops a repeat of the same source id, and the first one wins", () => {
    const local = result({ id: "abc", source: "local" });
    const fromProvider = result();

    expect(mergeResults([local], [fromProvider])).toEqual([local]);
  });

  it("drops the same work from another source: same kind, title and year", () => {
    const first = result({ provider: "tmdb", externalId: "movie/1" });
    const second = result({
      provider: "wikidata",
      externalId: "Q1",
      title: "DUNE",
    });

    expect(mergeResults([first], [second])).toEqual([first]);
  });

  it("keeps titles with the same name and a different year or kind", () => {
    const a = result({ externalId: "movie/1", year: 1984 });
    const b = result({ externalId: "movie/2", year: 2021 });
    const c = result({ externalId: "tv/3", type: "series", year: 2021 });

    expect(mergeResults([a, b, c])).toHaveLength(3);
  });

  it("returns an empty list for no lists", () => {
    expect(mergeResults()).toEqual([]);
  });
});

describe("rankResults", () => {
  it("puts an exact title first, then a close one, then a far one", () => {
    const exact = result({ externalId: "1", title: "Dune" });
    const close = result({
      externalId: "2",
      title: "Dune Part Two",
      year: 2024,
    });
    const far = result({ externalId: "3", title: "Casablanca", year: 1942 });

    const ranked = rankResults([far, close, exact], "dune");

    expect(ranked.map((r) => r.externalId)).toEqual(["1", "2", "3"]);
  });

  it("matches the original title too, without accents", () => {
    const byOriginal = result({
      externalId: "1",
      title: "Ataque a los Titanes",
      originalTitle: "Shingeki no Kyojin",
    });
    const other = result({ externalId: "2", title: "Otra cosa", year: 2000 });

    const ranked = rankResults([other, byOriginal], "shingeki no kyojin");

    expect(ranked[0].externalId).toBe("1");
  });

  it("breaks a tie by popularity, then by having text in the language asked for", () => {
    const quiet = result({
      externalId: "1",
      title: "Same",
      year: 2000,
      popularity: 1,
    });
    const popular = result({
      externalId: "2",
      title: "Same",
      year: 2001,
      popularity: 9,
    });
    const noText = result({
      externalId: "3",
      title: "Same",
      year: 2002,
      popularity: 1,
    });
    const withText = result({
      externalId: "4",
      title: "Same",
      year: 2003,
      popularity: 1,
      synopsis: "texto",
    });

    const ranked = rankResults([quiet, noText, withText, popular], "same");

    expect(ranked.map((r) => r.externalId)).toEqual(["2", "4", "1", "3"]);
  });

  it("does not change the list it receives", () => {
    const list = [
      result({ externalId: "2", title: "B" }),
      result({ externalId: "1", title: "A" }),
    ];
    const copy = [...list];

    rankResults(list, "a");

    expect(list).toEqual(copy);
  });
});
