import { describe, expect, it } from "vitest";

import {
  animeQid,
  filmQid,
  franchiseQid,
  lookupAnswer,
  mangaQid,
  membersAnswer,
} from "../../testing/wikidata";
import {
  buildLookupQuery,
  buildMembersQuery,
  formatOfClasses,
  largeFranchiseSize,
  mainClasses,
  mainFormats,
  parseLookup,
  parseMembers,
  qidOf,
  validSources,
} from "./map";

describe("buildLookupQuery", () => {
  it("asks for every source in one query, with the property of its scheme", () => {
    const query = buildLookupQuery([
      { scheme: "tmdb_tv", value: "1429" },
      { scheme: "tmdb_tv", value: "1396" },
      { scheme: "tmdb_movie", value: "603" },
      { scheme: "mal_manga", value: "2" },
      { scheme: "open_library", value: "OL893414W" },
    ]);

    expect(query).toContain('VALUES ?value { "1429" "1396" }');
    expect(query).toContain("wdt:P4983");
    expect(query).toContain('VALUES ?value { "603" }');
    expect(query).toContain("wdt:P4947");
    expect(query).toContain("wdt:P4087");
    expect(query).toContain('"OL893414W"');
    expect(query).toContain("wdt:P8345");
    expect(query).toContain("wdt:P144");
    expect(query).toContain("UNION");
  });

  it("never puts a value that is not a plain id in the query", () => {
    const query = buildLookupQuery([
      { scheme: "tmdb_tv", value: '1" } . ?x ?y ?z #' },
      { scheme: "open_library", value: "OL1W } DROP" },
      { scheme: "tmdb_movie", value: "603" },
    ]);

    expect(query).toContain('"603"');
    expect(query).not.toContain("DROP");
    expect(query).not.toContain("?x ?y ?z");
  });

  it("has nothing to ask when no source is valid", () => {
    expect(buildLookupQuery([])).toBeNull();
    expect(buildLookupQuery([{ scheme: "tmdb_tv", value: "abc" }])).toBeNull();
  });

  it("drops repeated sources", () => {
    expect(
      validSources([
        { scheme: "tmdb_tv", value: "1" },
        { scheme: "tmdb_tv", value: "1" },
      ]),
    ).toHaveLength(1);
  });
});

describe("parseLookup, the show in TVmaze (SAG-90)", () => {
  it("asks for the id of the show in TVmaze, in the same query", () => {
    const query = buildLookupQuery([{ scheme: "tmdb_tv", value: "1429" }]);

    expect(query).toContain("wdt:P8600");
    expect(query).toContain("?idTvmaze");
  });

  it("reads it with the item, and leaves it out when there is none or it is not a number", () => {
    const row = (idTvmaze?: string) => ({
      results: {
        bindings: [
          {
            scheme: { value: "tmdb_tv" },
            value: { value: "1" },
            item: { value: "http://www.wikidata.org/entity/Q1" },
            ...(idTvmaze === undefined
              ? {}
              : { idTvmaze: { value: idTvmaze } }),
          },
        ],
      },
    });

    expect(parseLookup(row("919"))[0]?.item.ids).toEqual({
      tmdb_tv: "1",
      tvmaze: "919",
    });
    expect(parseLookup(row())[0]?.item.ids).toEqual({ tmdb_tv: "1" });
    expect(parseLookup(row("1; DROP"))[0]?.item.ids).toEqual({ tmdb_tv: "1" });
  });
});

describe("parseLookup", () => {
  it("reads the item, its labels, its franchise and the work it is based on", () => {
    const [hit] = parseLookup(lookupAnswer);

    expect(hit).toEqual({
      source: { scheme: "tmdb_tv", value: "1429" },
      item: {
        qid: animeQid,
        labels: { es: "Ataque a los Titanes", en: "Attack on Titan" },
        format: "other",
        ids: { tmdb_tv: "1429", tvmaze: "919" },
        franchises: [franchiseQid],
        basedOn: [mangaQid],
      },
    });
  });

  it("skips rows that are not an item", () => {
    expect(
      parseLookup({
        results: {
          bindings: [
            { scheme: { value: "tmdb_tv" }, value: { value: "1" } },
            {
              scheme: { value: "nope" },
              value: { value: "1" },
              item: { value: "http://www.wikidata.org/entity/Q1" },
            },
          ],
        },
      }),
    ).toEqual([]);
    expect(parseLookup({})).toEqual([]);
  });
});

describe("buildMembersQuery", () => {
  it("asks for the members of the franchises and for the given items", () => {
    const query = buildMembersQuery([franchiseQid], [mangaQid]);

    expect(query).toContain(`VALUES ?fr { wd:${franchiseQid} }`);
    expect(query).toContain(`wd:${mangaQid}`);
    expect(query).toContain("LIMIT 400");
    expect(query).toContain("GROUP BY ?member");
  });

  it("asks only for the given items when there is no franchise", () => {
    const query = buildMembersQuery([], [mangaQid]);

    expect(query).not.toContain("VALUES ?fr");
    expect(query).toContain(`VALUES ?member { wd:${mangaQid} }`);
  });

  it("ignores anything that is not an item id, and has nothing to ask without one", () => {
    expect(buildMembersQuery(["Q1 } DROP"], ["bad"])).toBeNull();
  });
});

describe("parseMembers", () => {
  it("reads the year, and says null when Wikidata has no date (SAG-25)", () => {
    const members = parseMembers(membersAnswer);

    expect(members.find((item) => item.qid === mangaQid)).toMatchObject({
      year: 2009,
      detailed: true,
    });
    expect(members.find((item) => item.qid === filmQid)?.year).toBe(2015);
    expect(members.find((item) => item.qid === "Q20800425")?.year).toBeNull();
    expect(
      parseMembers({
        results: {
          bindings: [
            {
              member: { value: "http://www.wikidata.org/entity/Q1" },
              year: { value: "99999" },
            },
          ],
        },
      })[0]?.year,
    ).toBeNull();
  });

  it("asks for the date of each member, the publication or the start", () => {
    const query = buildMembersQuery([franchiseQid], []);

    expect(query).toContain("wdt:P577");
    expect(query).toContain("wdt:P580");
    expect(query).toContain("MIN(YEAR(?date))");
  });

  it("reads the format from the classes and the ids we can match", () => {
    const members = parseMembers(membersAnswer);

    expect(members.find((item) => item.qid === mangaQid)).toMatchObject({
      format: "manga",
      labels: { es: "Ataque a los Titanes", en: "Attack on Titan" },
      ids: { mal_manga: "23390", anilist_manga: "53390" },
      franchises: [franchiseQid],
    });
    expect(members.find((item) => item.qid === filmQid)).toMatchObject({
      format: "movie",
      ids: { tmdb_movie: "295830" },
    });
    expect(members.find((item) => item.qid === animeQid)).toMatchObject({
      format: "anime",
      ids: { tmdb_tv: "1429" },
    });
    expect(members.find((item) => item.qid === "Q20800425")?.format).toBe(
      "game",
    );
    expect(members.find((item) => item.qid === franchiseQid)).toMatchObject({
      format: "franchise",
      franchises: [],
    });
  });
});

describe("formatOfClasses", () => {
  it("takes the first known format, and 'other' when none is known", () => {
    expect(formatOfClasses(["Q1", "Q21198342"])).toBe("manga");
    expect(formatOfClasses(["Q7889", "Q11424"])).toBe("movie");
    expect(formatOfClasses(["Q1"])).toBe("other");
    expect(formatOfClasses([])).toBe("other");
  });
});

describe("qidOf", () => {
  it("reads an item id from an address or from the id itself", () => {
    expect(qidOf("http://www.wikidata.org/entity/Q42")).toBe("Q42");
    expect(qidOf("Q42")).toBe("Q42");
    expect(qidOf("P42")).toBeNull();
    expect(qidOf(undefined)).toBeNull();
  });
});

describe("large franchises (SAG-94)", () => {
  it("counts the members of each franchise, so a large one can be thinned", () => {
    const query = buildMembersQuery([franchiseQid], []) ?? "";

    expect(query).toContain("COUNT(DISTINCT ?each)");
    expect(query).toContain(`?size <= ${largeFranchiseSize}`);
    // Only the franchise branch has a size, so the items asked for by id are never dropped.
    expect(query).toContain("!BOUND(?size)");
  });

  it("keeps only a main work that a catalog knows once the franchise is large, oldest first", () => {
    const query = buildMembersQuery([franchiseQid], []) ?? "";

    expect(query).toContain("BOUND(?main)");
    for (const id of [
      "tmdbMovie",
      "tmdbTv",
      "malManga",
      "alManga",
      "openLibrary",
    ]) {
      expect(query).toContain(`BOUND(?${id})`);
    }
    expect(query).toContain("ORDER BY (COALESCE(?year, 9999)) ?member");
  });

  it("names the classes of the main formats and no others", () => {
    expect(mainClasses).toEqual(
      expect.arrayContaining([
        "Q63952888",
        "Q11424",
        "Q5398426",
        "Q21198342",
        "Q8261",
      ]),
    );
    // A video game, a media franchise and an unknown class are not a main work.
    expect(mainClasses).not.toContain("Q7889");
    expect(mainClasses).not.toContain("Q196600");
    expect(formatOfClasses(mainClasses.slice(0, 1))).not.toBe("other");
    expect(mainFormats).toEqual(["anime", "movie", "series", "manga", "book"]);
  });

  it("puts the main classes in the query", () => {
    const query = buildMembersQuery([franchiseQid], []) ?? "";

    for (const qid of mainClasses) expect(query).toContain(`wd:${qid}`);
  });
});
