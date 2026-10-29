import { describe, expect, it } from "vitest";

import { dune, duneDuplicate, duneMessiah } from "../../testing/open-library";
import {
  descriptionOf,
  groupWorks,
  hasSpanishEdition,
  mapWork,
  parseExternalId,
  pickSpanishTitle,
  spanishEditionTitles,
  withSpanishTitle,
} from "./map";

describe("pickSpanishTitle", () => {
  const pick = (
    titles: (string | null | undefined)[],
    original = "The Butterfly Garden",
  ) => pickSpanishTitle(titles, original);

  it("takes the title most editions share, whatever the capitals", () => {
    expect(
      pick([
        "El Jardín de Las Mariposas",
        "El jardín de las mariposas",
        "El jardín de las mariposas",
      ]),
    ).toBe("El jardín de las mariposas");
  });

  it("takes the only title when there is one", () => {
    expect(pick(["El jardín de las mariposas"])).toBe(
      "El jardín de las mariposas",
    );
  });

  it("is no answer when two titles tie", () => {
    expect(
      pick(["El jardín de las mariposas", "Jardín de mariposas"]),
    ).toBeNull();
  });

  it("ignores empty titles, and the original title itself with other capitals or accents", () => {
    expect(pick(["", "   ", null, undefined])).toBeNull();
    expect(pick(["the butterfly garden"])).toBeNull();
    expect(pick(["Dune"], "Dune")).toBeNull();
    expect(pick(["Jardín"], "Jardin")).toBeNull();
  });

  it("ignores a title with two languages, a note or a collection", () => {
    expect(
      pick([
        "Dune / Duna",
        "El Mesias De Dune/Dune Messiah",
        "Hijos De Dune (Dune Chronicles, Book 3)",
        "Dios Emperador [edición]",
      ]),
    ).toBeNull();
  });

  it("joins repeated spaces, and a clean title wins over the noisy ones", () => {
    expect(pick(["Dune  /  Duna", "El   mesías  de Dune"])).toBe(
      "El mesías de Dune",
    );
  });

  it("takes the first spelling when the spellings tie", () => {
    expect(pick(["El Jardín", "El jardín"])).toBe("El Jardín");
  });
});

describe("spanishEditionTitles", () => {
  it("keeps the titles of the editions in Spanish only", () => {
    expect(
      spanishEditionTitles([
        { title: "A", languages: [{ key: "/languages/spa" }] },
        { title: "B", languages: [{ key: "/languages/eng" }] },
        { title: "C", languages: [] },
        { title: "D" },
      ]),
    ).toEqual(["A"]);
  });
});

describe("hasSpanishEdition and withSpanishTitle", () => {
  it("reads the languages of the editions", () => {
    expect(hasSpanishEdition({ language: ["eng", "spa"] })).toBe(true);
    expect(hasSpanishEdition({ language: ["eng"] })).toBe(false);
    expect(hasSpanishEdition({})).toBe(false);
  });

  it("moves the given title to the original title, or changes nothing", () => {
    const book = mapWork(dune);
    if (!book) throw new Error("Expected a book");

    expect(withSpanishTitle(book, "Duna")).toMatchObject({
      title: "Duna",
      originalTitle: "Dune",
      titles: { en: "Dune" },
    });
    expect(withSpanishTitle(book, null)).toBe(book);
  });
});

describe("parseExternalId", () => {
  it("takes the key with or without the path", () => {
    expect(parseExternalId("/works/OL893414W")).toBe("OL893414W");
    expect(parseExternalId("OL893414W")).toBe("OL893414W");
  });

  it("refuses what is not a work key, so nothing odd reaches a URL", () => {
    for (const value of [
      "",
      "OL893414M",
      "ol893414w",
      "OL1W/../x",
      "tv/1429",
      "/authors/OL1A",
    ]) {
      expect(parseExternalId(value), value).toBeNull();
    }
  });
});

describe("descriptionOf", () => {
  it("reads a plain text and an object with a value, and turns CRLF into line breaks", () => {
    expect(descriptionOf({ description: "A\r\nB" })).toBe("A\nB");
    expect(descriptionOf({ description: { value: " Text " } })).toBe("Text");
  });

  it("is null when there is none", () => {
    expect(descriptionOf({})).toBeNull();
    expect(descriptionOf({ description: "  " })).toBeNull();
    expect(descriptionOf({ description: {} })).toBeNull();
  });
});

describe("mapWork", () => {
  it("maps a work to a book", () => {
    expect(mapWork(dune)).toEqual({
      type: "book",
      title: "Dune",
      originalTitle: null,
      year: 1965,
      synopsis: {},
      creators: ["Frank Herbert"],
      imageUrl: "https://covers.openlibrary.org/b/id/11481354-L.jpg",
      status: "unknown",
      popularity: 100,
      externalId: { provider: "open_library", id: "OL893414W" },
    });
  });

  it("leaves out what the work does not have", () => {
    const book = mapWork({ key: "/works/OL5W", title: "Anonymous" });

    expect(book).toMatchObject({ year: null, imageUrl: null, popularity: 0 });
    expect(book).not.toHaveProperty("creators");
  });

  it("is null for a record without a usable key or title", () => {
    expect(mapWork({ title: "No key" })).toBeNull();
    expect(mapWork({ key: "/works/OL5W", title: "  " })).toBeNull();
    expect(mapWork({ key: "/books/OL5M", title: "An edition" })).toBeNull();
  });
});

describe("groupWorks", () => {
  it("keeps one work for a title and author, the one with more editions, in the first place", () => {
    const works = [duneDuplicate, duneMessiah, dune].map((doc) => mapWork(doc));
    const grouped = groupWorks(works.filter((item) => item !== null));

    expect(grouped.map((item) => item.externalId.id)).toEqual([
      "OL893414W",
      "OL893461W",
    ]);
  });

  it("keeps two books with the same title and different authors", () => {
    const a = mapWork({
      key: "/works/OL1W",
      title: "Home",
      author_name: ["A"],
    });
    const b = mapWork({
      key: "/works/OL2W",
      title: "Home",
      author_name: ["B"],
    });

    expect(groupWorks([a, b].filter((item) => item !== null))).toHaveLength(2);
  });
});
