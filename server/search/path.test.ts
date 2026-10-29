import { describe, expect, it } from "vitest";

import { searchBackPath, searchPath } from "./path";

const origin = "https://sagashelf.app";

describe("searchPath", () => {
  it("writes the text and the tab, and leaves out what is empty", () => {
    expect(searchPath("dune", "book")).toBe("/search?q=dune&type=book");
    expect(searchPath("dune", undefined)).toBe("/search?q=dune");
    expect(searchPath("", "book")).toBe("/search?type=book");
    expect(searchPath("", undefined)).toBe("/search");
  });

  it("escapes the text", () => {
    expect(searchPath("a&b=c d", undefined)).toBe("/search?q=a%26b%3Dc+d");
  });
});

describe("searchBackPath", () => {
  it("goes back to the same results, with the tab they had", () => {
    expect(searchBackPath(`${origin}/search?q=the+pitt`, origin)).toBe(
      "/search?q=the+pitt",
    );
    expect(searchBackPath(`${origin}/search?q=dune&type=book`, origin)).toBe(
      "/search?q=dune&type=book",
    );
  });

  it("keeps a text with accents or symbols as the search would write it", () => {
    expect(
      searchBackPath(`${origin}/search?q=el%20jard%C3%ADn%20%26%20m`, origin),
    ).toBe("/search?q=el+jard%C3%ADn+%26+m");
  });

  it("ignores a tab that is not one of ours, as the search does", () => {
    expect(searchBackPath(`${origin}/search?q=dune&type=evil`, origin)).toBe(
      "/search?q=dune",
    );
  });

  it("reads only the text and the tab, never anything else the address had", () => {
    expect(
      searchBackPath(
        `${origin}/search?q=dune&type=book&redirect=https://evil.example&x=1#frag`,
        origin,
      ),
    ).toBe("/search?q=dune&type=book");
  });

  it("has no link without a Referer, or with one that is not an address", () => {
    expect(searchBackPath(null, origin)).toBeNull();
    expect(searchBackPath("", origin)).toBeNull();
    expect(searchBackPath("not an address", origin)).toBeNull();
  });

  it("has no link when the person did not come from the search", () => {
    for (const referer of [
      `${origin}/`,
      `${origin}/library`,
      `${origin}/media/movie/matrix-1`,
      `${origin}/search/extra?q=dune`,
      `${origin}/searchx?q=dune`,
      `${origin}/search-evil?q=dune`,
      `${origin}/xsearch?q=dune`,
      `${origin}/?next=/search?q=dune`,
    ]) {
      expect(searchBackPath(referer, origin)).toBeNull();
    }
  });

  it("has no link from another site, even one that looks like ours", () => {
    for (const referer of [
      "https://evil.example/search?q=dune",
      "http://sagashelf.app/search?q=dune",
      "https://sagashelf.app.evil.example/search?q=dune",
      "javascript:alert(1)",
    ]) {
      expect(searchBackPath(referer, origin)).toBeNull();
    }
  });

  it("builds the address itself even from an address with credentials, which is still our site", () => {
    expect(
      searchBackPath(
        "https://evil.example@sagashelf.app/search?q=dune",
        origin,
      ),
    ).toBe("/search?q=dune");
  });

  it("has no link for a search that would not have run", () => {
    expect(searchBackPath(`${origin}/search`, origin)).toBeNull();
    expect(searchBackPath(`${origin}/search?q=`, origin)).toBeNull();
    expect(searchBackPath(`${origin}/search?q=a`, origin)).toBeNull();
    expect(searchBackPath(`${origin}/search?q=%20%20a%20`, origin)).toBeNull();
    expect(
      searchBackPath(`${origin}/search?q=${"x".repeat(101)}`, origin),
    ).toBeNull();
    expect(
      searchBackPath(`${origin}/search?q=${"x".repeat(100)}`, origin),
    ).not.toBeNull();
  });

  it("counts characters, not bytes, as the search does", () => {
    expect(
      searchBackPath(`${origin}/search?q=${"é".repeat(100)}`, origin),
    ).not.toBeNull();
  });
});
