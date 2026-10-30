import { describe, expect, it } from "vitest";

import {
  adult,
  berserk,
  berserkId,
  vrmmo,
  vrmmoId,
} from "../../testing/mangadex";
import {
  genresOfTags,
  mapManga,
  parseExternalId,
  plainDescription,
} from "./map";

describe("parseExternalId", () => {
  it("takes a uuid in any case and gives it in lowercase", () => {
    expect(parseExternalId(vrmmoId.toUpperCase())).toBe(vrmmoId);
  });

  it("refuses what is not a uuid, so nothing odd reaches a URL", () => {
    for (const value of ["", "123", `${vrmmoId}/../x`, "movie/603", "OL1W"]) {
      expect(parseExternalId(value), value).toBeNull();
    }
  });
});

describe("plainDescription", () => {
  it("cuts at the rule that starts the credits and links", () => {
    expect(plainDescription("Story.\n\n___\n**Designer:** x")).toBe("Story.");
    expect(plainDescription("Story.\n\n---\n\nNote")).toBe("Story.");
  });

  it("turns Markdown links into their text and drops the bold marks", () => {
    expect(
      plainDescription("A **bold** tale from [Someone](https://x.test)."),
    ).toBe("A bold tale from Someone.");
  });

  it("is null for nothing", () => {
    expect(plainDescription(undefined)).toBeNull();
    expect(plainDescription("  ")).toBeNull();
    expect(plainDescription("---\nonly credits")).toBeNull();
  });
});

describe("genresOfTags", () => {
  const tag = (name: string, group: string) => ({
    attributes: { name: { en: name }, group },
  });

  it("reads the genres and the themes that match one of ours, once each", () => {
    expect(
      genresOfTags([
        tag("Isekai", "genre"),
        tag("Mecha", "genre"),
        tag("Superhero", "genre"),
        tag("Magical Girls", "genre"),
        tag("Reverse Harem", "theme"),
        tag("Harem", "theme"),
        tag("Ghosts", "theme"),
        tag("Demons", "theme"),
        tag("Police", "theme"),
        tag("Mafia", "theme"),
      ]),
    ).toEqual([
      "isekai",
      "mecha",
      "superhero",
      "magical_girl",
      "harem",
      "supernatural",
      "crime",
    ]);
  });

  it("matches the English name whatever its case, with the quotes of Boys' Love", () => {
    expect(
      genresOfTags([
        tag("SCI-FI", "genre"),
        tag("slice of life", "genre"),
        tag("Boys' Love", "genre"),
        tag("Girls' Love", "genre"),
      ]),
    ).toEqual(["sci_fi", "slice_of_life", "boys_love", "girls_love"]);
  });

  it("never reads the groups format and content, even when the name matches", () => {
    expect(
      genresOfTags([tag("Action", "format"), tag("Horror", "content")]),
    ).toEqual([]);
  });

  it("drops the tags that have no genre of ours, and the ones with no name or group", () => {
    expect(
      genresOfTags([
        tag("Aliens", "theme"),
        tag("Loli", "theme"),
        { attributes: { group: "genre" } },
        { attributes: { name: { en: "Action" } } },
        {},
      ]),
    ).toEqual([]);
  });
});

describe("mapManga", () => {
  it("chooses the title in the language of the visitor from the alternative titles", () => {
    expect(mapManga(berserk, "es")?.title).toBe("Berserk (edición en español)");
    expect(mapManga(berserk, "en")?.title).toBe("Berserk");
  });

  it("maps a manga: authors once, the cover, the status and both descriptions", () => {
    expect(mapManga(berserk, "en")).toEqual({
      type: "manga",
      title: "Berserk",
      originalTitle: null,
      year: 1989,
      synopsis: {
        es: "Guts, un ex mercenario, caza demonios.",
        en: "Guts, a former mercenary, hunts demons.",
      },
      creators: ["Miura Kentarou"],
      genres: [
        "action",
        "adventure",
        "supernatural",
        "drama",
        "fantasy",
        "horror",
        "psychological",
        "tragedy",
      ],
      imageUrl: `https://uploads.mangadex.org/covers/${berserkId}/11111111-2222-4333-8444-555555555555.jpg`,
      status: "ongoing",
      popularity: 0,
      externalId: { provider: "mangadex", id: berserkId },
    });
  });

  it("keeps the title MangaDex lists as the original when it differs from the one shown", () => {
    expect(mapManga(berserk, "es")?.originalTitle).toBe("Berserk");
  });

  it("falls back to English and then to what is listed", () => {
    expect(mapManga(vrmmo, "es")?.title).toContain("VRMMO Chronicles");
    const onlyRomaji = {
      ...berserk,
      attributes: { ...berserk.attributes, altTitles: [] },
    };
    expect(mapManga(onlyRomaji, "es")?.title).toBe("Berserk");
  });

  it("maps the statuses it knows and calls the rest unknown", () => {
    const withStatus = (status: string) =>
      mapManga({ ...vrmmo, attributes: { ...vrmmo.attributes, status } }, "en")
        ?.status;

    expect(withStatus("completed")).toBe("finished");
    expect(withStatus("ongoing")).toBe("ongoing");
    expect(withStatus("cancelled")).toBe("cancelled");
    expect(withStatus("hiatus")).toBe("unknown");
  });

  it("leaves out what the manga does not have", () => {
    const bare = mapManga(
      {
        id: vrmmoId,
        attributes: { title: { en: "Bare" }, contentRating: "safe" },
      },
      "en",
    );

    expect(bare).toMatchObject({ year: null, imageUrl: null, synopsis: {} });
    expect(bare).not.toHaveProperty("creators");
    // MangaDex always sends tags, so a manga without any is "asked, none of ours fits".
    expect(bare?.genres).toEqual([]);
  });

  it("is null for adult material, for a record with no title and for a bad id", () => {
    expect(mapManga(adult, "en")).toBeNull();
    expect(
      mapManga({ ...adult, attributes: { contentRating: "erotica" } }, "en"),
    ).toBeNull();
    expect(
      mapManga({ id: vrmmoId, attributes: { title: {} } }, "en"),
    ).toBeNull();
    expect(mapManga({ id: "nope", attributes: {} }, "en")).toBeNull();
  });
});
