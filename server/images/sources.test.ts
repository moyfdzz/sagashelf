import { describe, expect, it } from "vitest";

import {
  imageSourceOf,
  imageSrc,
  isAllowedRedirect,
  upstreamUrl,
} from "./sources";

describe("upstreamUrl", () => {
  it("builds the address of a TMDB image from the host written in the code", () => {
    expect(upstreamUrl("tmdb", "w342", "abc123.jpg")).toBe(
      "https://image.tmdb.org/t/p/w342/abc123.jpg",
    );
  });

  it.each([
    ["a provider that is not on the list", "evil", "w342", "a.jpg"],
    [
      "a provider named like an object property",
      "constructor",
      "w342",
      "a.jpg",
    ],
    ["a size that is not offered", "tmdb", "original", "a.jpg"],
    ["a size with a path in it", "tmdb", "w342/../x", "a.jpg"],
    ["a file with a path", "tmdb", "w342", "../a.jpg"],
    ["a file with a query", "tmdb", "w342", "a.jpg?x=1"],
    ["a file with another extension", "tmdb", "w342", "a.svg"],
    ["a file with a host in it", "tmdb", "w342", "evil.com%2Fa.jpg"],
    ["an empty file", "tmdb", "w342", ""],
    ["a very long file", "tmdb", "w342", `${"a".repeat(70)}.jpg`],
  ])("refuses %s", (_name, provider, size, file) => {
    expect(upstreamUrl(provider, size, file)).toBeNull();
  });
});

describe("imageSrc", () => {
  it("turns a stored TMDB address into one of our own, at the size asked for", () => {
    expect(imageSrc("https://image.tmdb.org/t/p/w500/matrix.jpg", "w185")).toBe(
      "/img/tmdb/w185/matrix.jpg",
    );
  });

  it.each([
    ["nothing", null],
    ["an empty string", ""],
    ["text that is not an address", "not a url"],
    ["another host", "https://evil.example/t/p/w500/matrix.jpg"],
    ["a look-alike host", "https://image.tmdb.org.evil.example/t/p/w500/a.jpg"],
    ["plain http", "http://image.tmdb.org/t/p/w500/matrix.jpg"],
    ["another path on the right host", "https://image.tmdb.org/other/a.jpg"],
    ["a file the proxy would refuse", "https://image.tmdb.org/t/p/w500/a.svg"],
  ])("gives no image for %s", (_name, imageUrl) => {
    expect(imageSrc(imageUrl, "w185")).toBeNull();
  });

  it("gives no image for a size that is not offered", () => {
    expect(imageSrc("https://image.tmdb.org/t/p/w500/a.jpg", "w9999")).toBe(
      null,
    );
  });
});

describe("Open Library covers", () => {
  it.each([
    ["w92", "S"],
    ["w185", "M"],
    ["w342", "L"],
    ["w500", "L"],
  ])("asks for the size letter that fits %s", (size, letter) => {
    expect(upstreamUrl("open_library", size, "11481354.jpg")).toBe(
      `https://covers.openlibrary.org/b/id/11481354-${letter}.jpg`,
    );
  });

  it.each([
    ["a name that is not a cover id", "dune.jpg"],
    ["a file with a path", "../1.jpg"],
    ["another extension", "11481354.png"],
    ["an id that is too long", `${"1".repeat(13)}.jpg`],
    ["a lookup by ISBN, which is rate limited", "isbn-9780441172719.jpg"],
  ])("refuses %s", (_name, file) => {
    expect(upstreamUrl("open_library", "w342", file)).toBeNull();
  });

  it("turns a stored cover address into one of our own", () => {
    expect(
      imageSrc("https://covers.openlibrary.org/b/id/11481354-L.jpg", "w185"),
    ).toBe("/img/open_library/w185/11481354.jpg");
  });

  it.each([
    ["a cover by ISBN", "https://covers.openlibrary.org/b/isbn/978044117.jpg"],
    ["another host", "https://evil.example/b/id/1-L.jpg"],
    [
      "a look-alike host",
      "https://covers.openlibrary.org.evil.example/b/id/1-L.jpg",
    ],
  ])("gives no image for %s", (_name, imageUrl) => {
    expect(imageSrc(imageUrl, "w185")).toBeNull();
  });
});

describe("isAllowedRedirect", () => {
  it("lets Open Library covers go to archive.org and its servers, over https", () => {
    for (const url of [
      "https://archive.org/download/m_covers/1.zip/1-M.jpg",
      "https://ia801604.us.archive.org/view_archive.php?file=1.jpg",
    ]) {
      expect(isAllowedRedirect("open_library", new URL(url)), url).toBe(true);
    }
  });

  it.each([
    ["plain http", "http://archive.org/a.jpg"],
    ["another host", "https://evil.example/a.jpg"],
    ["a look-alike host", "https://archive.org.evil.example/a.jpg"],
    ["a host that only ends the same", "https://notarchive.org/a.jpg"],
    ["a port", "https://archive.org:8443/a.jpg"],
    ["credentials", "https://user:pass@archive.org/a.jpg"],
  ])("refuses %s", (_name, url) => {
    expect(isAllowedRedirect("open_library", new URL(url))).toBe(false);
  });

  it("refuses every redirect of a provider with no list, and of an unknown one", () => {
    const url = new URL("https://archive.org/a.jpg");

    expect(isAllowedRedirect("tmdb", url)).toBe(false);
    expect(isAllowedRedirect("constructor", url)).toBe(false);
  });
});

describe("MangaDex covers", () => {
  const manga = "b00acc54-2bf1-440e-8f33-da87227d82d6";
  const cover = "fac369b9-c8f3-4fa2-b9da-f2fab0a9ca35.png";

  it.each([
    ["w92", "256"],
    ["w185", "256"],
    ["w342", "512"],
    ["w780", "512"],
  ])("asks for the thumbnail that fits %s", (size, pixels) => {
    expect(upstreamUrl("mangadex", size, `${manga}_${cover}`)).toBe(
      `https://uploads.mangadex.org/covers/${manga}/${cover}.${pixels}.jpg`,
    );
  });

  it.each([
    ["a file with no manga id", cover],
    ["a manga id that is not a uuid", `1234_${cover}`],
    ["a cover that is not a uuid", `${manga}_cover.png`],
    ["a path in the cover", `${manga}_../${cover}`],
    ["another extension", `${manga}_fac369b9-c8f3-4fa2-b9da-f2fab0a9ca35.svg`],
    ["a query", `${manga}_${cover}?x=1`],
  ])("refuses %s", (_name, file) => {
    expect(upstreamUrl("mangadex", "w342", file)).toBeNull();
  });

  it("turns a stored cover address into one of our own", () => {
    expect(
      imageSrc(`https://uploads.mangadex.org/covers/${manga}/${cover}`, "w185"),
    ).toBe(`/img/mangadex/w185/${manga}_${cover}`);
  });

  it.each([
    ["another host", `https://evil.example/covers/${manga}/${cover}`],
    ["the API host", `https://api.mangadex.org/covers/${manga}/${cover}`],
    [
      "a thumbnail address",
      `https://uploads.mangadex.org/covers/${manga}/${cover}.256.jpg`,
    ],
    ["another path", `https://uploads.mangadex.org/other/${manga}/${cover}`],
  ])("gives no image for %s", (_name, imageUrl) => {
    expect(imageSrc(imageUrl, "w185")).toBeNull();
  });

  it("tells the proxy to send a User-Agent, to space the calls and which title a file is of", () => {
    const source = imageSourceOf("mangadex");

    expect(source?.sendUserAgent).toBe(true);
    expect(source?.maxPerSecond).toBe(4);
    expect(source?.externalIdOf?.(`${manga}_${cover}`)).toBe(manga);
    expect(imageSourceOf("tmdb")?.sendUserAgent).toBeUndefined();
    expect(imageSourceOf("constructor")).toBeNull();
  });
});

describe("the MangaDex cover pattern", () => {
  it("only accepts a real dot before the extension", () => {
    const manga = "b00acc54-2bf1-440e-8f33-da87227d82d6";
    const cover = "fac369b9-c8f3-4fa2-b9da-f2fab0a9ca35";

    expect(
      upstreamUrl("mangadex", "w342", `${manga}_${cover}.png`),
    ).not.toBeNull();
    expect(upstreamUrl("mangadex", "w342", `${manga}_${cover}xpng`)).toBeNull();
    expect(upstreamUrl("mangadex", "w342", `${manga}_${cover}-png`)).toBeNull();
  });
});
