import { describe, expect, it } from "vitest";

import { dune, duneDuplicate, duneMessiah } from "../../testing/open-library";
import { descriptionOf, groupWorks, mapWork, parseExternalId } from "./map";

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
