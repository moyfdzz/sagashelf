import { describe, expect, it } from "vitest";

import { buildJsonLd, shortDescription } from "./json-ld";

const base = {
  originalTitle: null,
  description: null,
  year: null,
  url: "https://sagashelf.app/media/movie/matrix-x",
  image: null,
  seasonCount: 0,
};

describe("buildJsonLd", () => {
  it("describes a movie with what the page shows", () => {
    const ld = buildJsonLd({
      ...base,
      type: "movie",
      externalId: "movie/603",
      title: "Matrix",
      originalTitle: "The Matrix",
      description: "Un programador.",
      year: 1999,
      image: "https://sagashelf.app/img/tmdb/w500/matrix.jpg",
    });

    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "Movie",
      name: "Matrix",
      url: base.url,
      alternateName: "The Matrix",
      description: "Un programador.",
      image: "https://sagashelf.app/img/tmdb/w500/matrix.jpg",
      datePublished: "1999",
    });
  });

  it("counts the seasons of a series", () => {
    const ld = buildJsonLd({
      ...base,
      type: "series",
      externalId: "tv/1396",
      title: "Breaking Bad",
      seasonCount: 5,
    });

    expect(ld).toMatchObject({ "@type": "TVSeries", numberOfSeasons: 5 });
  });

  it("leaves out what it does not have", () => {
    const ld = buildJsonLd({
      ...base,
      type: "movie",
      externalId: "movie/1",
      title: "X",
    });

    expect(Object.keys(ld).sort()).toEqual(
      ["@context", "@type", "name", "url"].sort(),
    );
  });

  it("tells an anime movie from an anime series by the id of its source", () => {
    const movie = buildJsonLd({
      ...base,
      type: "anime",
      externalId: "movie/372058",
      title: "Your Name.",
    });
    const series = buildJsonLd({
      ...base,
      type: "anime",
      externalId: "tv/1429",
      title: "Ataque a los Titanes",
    });

    expect(movie["@type"]).toBe("Movie");
    expect(series["@type"]).toBe("TVSeries");
  });

  it("uses Book for books and manga", () => {
    expect(
      buildJsonLd({ ...base, type: "manga", externalId: "x", title: "X" })[
        "@type"
      ],
    ).toBe("Book");
  });
});

describe("the authors of a book", () => {
  it("lists them as people, and only for a book", () => {
    const book = buildJsonLd({
      ...base,
      type: "book",
      externalId: "OL893414W",
      title: "Dune",
      creators: ["Frank Herbert", "Brian Herbert"],
    });
    const movie = buildJsonLd({
      ...base,
      type: "movie",
      externalId: "movie/603",
      title: "Matrix",
      creators: ["Someone"],
    });

    expect(book.author).toEqual([
      { "@type": "Person", name: "Frank Herbert" },
      { "@type": "Person", name: "Brian Herbert" },
    ]);
    expect(movie).not.toHaveProperty("author");
  });

  it("leaves the field out when there are no authors", () => {
    expect(
      buildJsonLd({
        ...base,
        type: "book",
        externalId: "OL1W",
        title: "A book",
        creators: [],
      }),
    ).not.toHaveProperty("author");
  });
});

describe("shortDescription", () => {
  it("gives nothing for nothing", () => {
    expect(shortDescription(null)).toBeNull();
    expect(shortDescription("   ")).toBeNull();
  });

  it("keeps a short text and collapses its spaces", () => {
    expect(shortDescription("Una  historia\ncorta.")).toBe(
      "Una historia corta.",
    );
  });

  it("cuts a long text at a word and adds an ellipsis", () => {
    const text = "palabra ".repeat(60).trim();
    const cut = shortDescription(text, 50);

    expect(cut?.endsWith("…")).toBe(true);
    expect([...(cut ?? "")].length).toBeLessThanOrEqual(51);
    expect(cut).not.toMatch(/palabr…$/);
  });
});
