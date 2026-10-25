import { describe, expect, it } from "vitest";

import { imageSrc, upstreamUrl } from "./sources";

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
