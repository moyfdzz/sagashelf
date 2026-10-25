import { describe, expect, it } from "vitest";

import { ProviderError } from "./http";
import { searchAll } from "./search-all";
import type {
  MediaKind,
  MediaProvider,
  NormalizedMedia,
  ProviderId,
} from "./types";

function item(title: string, provider: ProviderId): NormalizedMedia {
  return {
    type: "movie",
    title,
    originalTitle: null,
    year: null,
    synopsis: {},
    imageUrl: null,
    status: "unknown",
    popularity: 0,
    externalId: { provider, id: title },
  };
}

function fake(
  id: ProviderId,
  types: MediaKind[],
  search: MediaProvider["search"],
): MediaProvider {
  return {
    id,
    capabilities: { types, parts: false, trending: false },
    attribution: { name: id, url: "https://example.test", notice: "" },
    search,
    getById: async () => null,
    getParts: async () => [],
  };
}

describe("searchAll", () => {
  it("merges what every provider that covers the type answers", async () => {
    const providers = [
      fake("tmdb", ["movie"], async () => [item("Dune", "tmdb")]),
      fake("open_library", ["book"], async () => [
        item("Dune book", "open_library"),
      ]),
    ];

    const outcome = await searchAll(providers, "dune", {
      type: "movie",
      locale: "es",
    });

    // The book provider does not cover movies, so it is not asked.
    expect(outcome.results.map((result) => result.item.title)).toEqual([
      "Dune",
    ]);
    expect(outcome.failures).toEqual([]);
  });

  it("asks every provider when there is no type", async () => {
    const providers = [
      fake("tmdb", ["movie"], async () => [item("A", "tmdb")]),
      fake("open_library", ["book"], async () => [item("B", "open_library")]),
    ];

    const outcome = await searchAll(providers, "x", { locale: "en" });

    expect(outcome.results).toHaveLength(2);
  });

  it("keeps the other results when a provider is down", async () => {
    const providers = [
      fake("tmdb", ["movie", "book"], async () => {
        throw new ProviderError("tmdb", "timeout");
      }),
      fake("open_library", ["movie", "book"], async () => [
        item("Still here", "open_library"),
      ]),
    ];

    const outcome = await searchAll(providers, "x", { locale: "es" });

    expect(outcome.results.map((result) => result.item.title)).toEqual([
      "Still here",
    ]);
    expect(outcome.failures).toEqual([{ provider: "tmdb", reason: "timeout" }]);
  });

  it("reports only the kind of an unknown error, never its text", async () => {
    const providers = [
      fake("tmdb", ["movie"], async () => {
        throw new Error("secret-token leaked in a message");
      }),
    ];

    const outcome = await searchAll(providers, "x", { locale: "es" });

    expect(outcome.failures).toEqual([{ provider: "tmdb", reason: "error" }]);
    expect(JSON.stringify(outcome)).not.toContain("secret");
  });

  it("answers with nothing, and no failure, when there are no providers", async () => {
    expect(await searchAll([], "x", { locale: "es" })).toEqual({
      results: [],
      failures: [],
    });
  });
});
