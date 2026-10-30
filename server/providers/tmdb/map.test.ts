import { describe, expect, it } from "vitest";

import {
  attackOnTitan,
  breakingBad,
  matrix,
  rickAndMorty,
  yourName,
} from "../../testing/tmdb";
import {
  classify,
  genresOf,
  mapParts,
  mapTitle,
  parseExternalId,
  toExternalId,
} from "./map";

describe("classify", () => {
  it("calls an animated series made in Japan anime", () => {
    expect(classify("tv", attackOnTitan)).toBe("anime");
  });

  it("calls an animated movie in Japanese anime", () => {
    expect(classify("movie", yourName)).toBe("anime");
  });

  it("does not call an animated series made elsewhere anime", () => {
    expect(classify("tv", rickAndMorty)).toBe("series");
  });

  it("does not call a live-action Japanese title anime", () => {
    expect(
      classify("tv", { id: 1, genre_ids: [18], origin_country: ["JP"] }),
    ).toBe("series");
  });

  it("reads the genres of a detail response too", () => {
    expect(
      classify("tv", {
        id: 1,
        genres: [{ id: 16 }],
        origin_country: ["JP"],
      }),
    ).toBe("anime");
  });

  it("keeps movies and series apart otherwise", () => {
    expect(classify("movie", matrix)).toBe("movie");
    expect(classify("tv", breakingBad)).toBe("series");
  });
});

describe("external ids", () => {
  it("keeps the kind, because a movie and a series can share a number", () => {
    expect(toExternalId("movie", 603)).toBe("movie/603");
    expect(toExternalId("tv", 603)).toBe("tv/603");
  });

  it("reads them back and refuses anything else", () => {
    expect(parseExternalId("tv/1396")).toEqual({ kind: "tv", id: 1396 });
    expect(parseExternalId("movie/603")).toEqual({ kind: "movie", id: 603 });
    for (const bad of ["603", "person/1", "tv/", "tv/1/2", "tv/abc", "../x"]) {
      expect(parseExternalId(bad)).toBeNull();
    }
  });
});

describe("mapTitle", () => {
  it("maps a movie in the language that was asked for", () => {
    expect(mapTitle("movie", matrix, "es")).toEqual({
      type: "movie",
      title: "Matrix",
      originalTitle: "The Matrix",
      year: 1999,
      synopsis: { es: "Un programador descubre la verdad sobre su mundo." },
      imageUrl: "https://image.tmdb.org/t/p/w500/matrix.jpg",
      status: "unknown",
      popularity: 85.5,
      genres: ["action", "sci_fi"],
      externalId: { provider: "tmdb", id: "movie/603" },
    });
  });

  it("reads the genres from the numbers of a search and from the list of a title", () => {
    expect(
      mapTitle("tv", { id: 1, name: "x", genre_ids: [18, 80] }, "en"),
    ).toMatchObject({
      genres: ["drama", "crime"],
    });
    expect(
      mapTitle("tv", { id: 1, name: "x", genres: [{ id: 35 }] }, "en").genres,
    ).toEqual(["comedy"]);
  });

  it("does not say the genres when TMDB sent no list, and says none when the list is empty", () => {
    expect(mapTitle("tv", { id: 1, name: "x" }, "en")).not.toHaveProperty(
      "genres",
    );
    expect(
      mapTitle("tv", { id: 1, name: "x", genre_ids: [] }, "en").genres,
    ).toEqual([]);
  });

  it("maps a series and keeps the original title only when it differs", () => {
    const item = mapTitle("tv", breakingBad, "en");

    expect(item.type).toBe("series");
    expect(item.originalTitle).toBeNull();
    expect(item.year).toBe(2008);
    expect(item.synopsis).toEqual({ en: breakingBad.overview });
    expect(item.externalId.id).toBe("tv/1396");
  });

  it("has no image, no synopsis and no year when TMDB has none", () => {
    const item = mapTitle(
      "tv",
      { id: 5, name: "Bare", overview: "  ", poster_path: null },
      "es",
    );

    expect(item).toMatchObject({ imageUrl: null, synopsis: {}, year: null });
  });

  it("falls back to the original title, and ignores a year out of range", () => {
    const item = mapTitle(
      "movie",
      { id: 6, original_title: "Only Original", release_date: "0001-01-01" },
      "en",
    );

    expect(item.title).toBe("Only Original");
    expect(item.year).toBeNull();
  });

  it.each([
    ["Returning Series", "ongoing"],
    ["Ended", "finished"],
    ["Released", "finished"],
    ["Canceled", "cancelled"],
    ["In Production", "upcoming"],
    ["Planned", "upcoming"],
    ["Something new", "unknown"],
  ])("maps the status %s to %s", (status, expected) => {
    expect(mapTitle("tv", { id: 1, name: "x", status }, "en").status).toBe(
      expected,
    );
  });
});

describe("genresOf", () => {
  it("turns the numbers of the movies into our genres", () => {
    expect(genresOf([28, 12, 35, 80, 99, 18, 10751, 14, 36, 27])).toEqual([
      "action",
      "adventure",
      "comedy",
      "crime",
      "documentary",
      "drama",
      "family",
      "fantasy",
      "historical",
      "horror",
    ]);
    expect(genresOf([10402, 9648, 10749, 878, 53, 10752, 37])).toEqual([
      "music",
      "mystery",
      "romance",
      "sci_fi",
      "thriller",
      "war",
      "western",
    ]);
  });

  it("splits the joined genres of series in two, once each", () => {
    expect(genresOf([10759, 10765])).toEqual([
      "action",
      "adventure",
      "sci_fi",
      "fantasy",
    ]);
    expect(genresOf([10759, 28])).toEqual(["action", "adventure"]);
  });

  it("maps the genres only series have", () => {
    expect(genresOf([10762, 10763, 10764, 10766, 10767, 10768])).toEqual([
      "family",
      "news",
      "reality",
      "soap_opera",
      "talk_show",
      "war",
    ]);
  });

  it("gives nothing for Animation and TV Movie, which are formats, nor for a number it does not know", () => {
    expect(genresOf([16, 10770, 99999])).toEqual([]);
  });

  it("keeps an anime to the genres it has besides Animation", () => {
    expect(mapTitle("tv", attackOnTitan, "en").genres).toEqual([
      "action",
      "adventure",
    ]);
  });
});

describe("mapParts", () => {
  it("lists each season followed by its episodes", () => {
    expect(
      mapParts([
        {
          season_number: 1,
          name: "Temporada 1",
          air_date: "2013-04-07",
          episodes: [
            { episode_number: 1, name: "Uno", air_date: "2013-04-07" },
          ],
        },
        { season_number: 2, name: "", air_date: null },
      ]),
    ).toEqual([
      {
        kind: "season",
        number: 1,
        title: "Temporada 1",
        airDate: "2013-04-07",
      },
      {
        kind: "episode",
        number: 1,
        title: "Uno",
        airDate: "2013-04-07",
        seasonNumber: 1,
      },
      { kind: "season", number: 2, title: null, airDate: null },
    ]);
  });
});

describe("the length of a title (SAG-61)", () => {
  it("takes the minutes of a movie, and nothing when TMDB sends 0 or none", () => {
    expect(
      mapTitle("movie", { id: 1, title: "A", runtime: 169 }, "es"),
    ).toMatchObject({ runtimeMinutes: 169 });
    for (const runtime of [0, null, undefined, -5, 1.5]) {
      expect(
        mapTitle("movie", { id: 1, title: "A", runtime }, "es"),
      ).not.toHaveProperty("runtimeMinutes");
    }
  });

  it("takes the average of the episode lengths of a series, and ignores the ones that mean nothing", () => {
    expect(
      mapTitle("tv", { id: 2, name: "B", episode_run_time: [45, 50, 0] }, "es"),
    ).toMatchObject({ runtimeMinutes: 48 });
    for (const list of [[], [0], undefined]) {
      expect(
        mapTitle("tv", { id: 2, name: "B", episode_run_time: list }, "es"),
      ).not.toHaveProperty("runtimeMinutes");
    }
  });

  it("keeps the length of each episode that has one", () => {
    const parts = mapParts([
      {
        season_number: 1,
        episodes: [
          { episode_number: 1, runtime: 58 },
          { episode_number: 2, runtime: null },
          { episode_number: 3, runtime: 0 },
        ],
      },
    ]);
    const episodes = parts.filter((part) => part.kind === "episode");

    expect(episodes[0]).toMatchObject({ runtimeMinutes: 58 });
    expect(episodes[1]).not.toHaveProperty("runtimeMinutes");
    expect(episodes[2]).not.toHaveProperty("runtimeMinutes");
  });
});
