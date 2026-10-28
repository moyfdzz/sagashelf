import { describe, expect, it } from "vitest";

import { buildProviders } from "./registry";

describe("buildProviders", () => {
  it("has no provider without a secret and without Open Library switched on", () => {
    expect(buildProviders({})).toEqual([]);
    expect(buildProviders({ tmdbReadAccessToken: "" })).toEqual([]);
    expect(buildProviders({ openLibraryEnabled: false })).toEqual([]);
  });

  it("has TMDB when its token is set, and reuses it so its limits persist", () => {
    const first = buildProviders({ tmdbReadAccessToken: "demo-token" });
    const second = buildProviders({ tmdbReadAccessToken: "demo-token" });

    expect(first.map((provider) => provider.id)).toEqual(["tmdb"]);
    expect(second[0]).toBe(first[0]);
  });

  it("has Open Library only when it is switched on, with no key, and reuses it", () => {
    const first = buildProviders({ openLibraryEnabled: true });
    const second = buildProviders({ openLibraryEnabled: true });

    expect(first.map((provider) => provider.id)).toEqual(["open_library"]);
    expect(second[0]).toBe(first[0]);
  });

  it("has MangaDex only when it is switched on, with no key, and reuses it", () => {
    const first = buildProviders({ mangadexEnabled: true });
    const second = buildProviders({ mangadexEnabled: true });

    expect(first.map((provider) => provider.id)).toEqual(["mangadex"]);
    expect(second[0]).toBe(first[0]);
    expect(buildProviders({ mangadexEnabled: false })).toEqual([]);
  });

  it("has all three in order when everything is on", () => {
    const providers = buildProviders({
      tmdbReadAccessToken: "demo-token",
      openLibraryEnabled: true,
      mangadexEnabled: true,
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      "tmdb",
      "open_library",
      "mangadex",
    ]);
  });

  it("has both, TMDB first", () => {
    const providers = buildProviders({
      tmdbReadAccessToken: "demo-token",
      openLibraryEnabled: true,
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      "tmdb",
      "open_library",
    ]);
  });
});
