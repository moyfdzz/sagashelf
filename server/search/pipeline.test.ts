import { describe, expect, it, vi } from "vitest";

import type { LocalHit } from "../db/search-local";
import { ProviderError } from "../providers/http";
import type {
  MediaKind,
  MediaProvider,
  NormalizedMedia,
  ProviderId,
} from "../providers/types";
import { createSearchCache } from "./cache";
import { enoughLocalHits, runSearch, type SearchDeps } from "./pipeline";

function media(title: string, id: string, year = 2000): NormalizedMedia {
  return {
    type: "movie",
    title,
    originalTitle: null,
    year,
    synopsis: { es: `Sobre ${title}` },
    imageUrl: null,
    status: "unknown",
    popularity: 1,
    externalId: { provider: "tmdb", id },
  };
}

function hit(overrides: Partial<LocalHit> = {}): LocalHit {
  return {
    id: "local-1",
    type: "movie",
    title: "Dune",
    originalTitle: null,
    year: 2021,
    synopsis: {},
    popularity: 5,
    provider: "tmdb",
    externalId: "movie/1",
    exact: false,
    similarity: 0.9,
    ...overrides,
  };
}

function provider(
  id: ProviderId,
  search: MediaProvider["search"],
  types: MediaKind[] = ["movie", "series", "anime"],
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

/** A cache in memory, plus a way to count how often it was read and written. */
function memoryCache() {
  const store = new Map<string, Response>();
  const raw = {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      store.set(request.url, response);
    }),
  };
  return { cache: createSearchCache(raw as unknown as Cache), raw };
}

function setup(overrides: Partial<SearchDeps> = {}) {
  const logs: string[] = [];
  const { cache, raw } = memoryCache();
  const deps: SearchDeps = {
    searchLocal: vi.fn(async () => []),
    providers: [],
    cache,
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, logs, raw };
}

const ask = (query: string, type?: "movie") => ({
  query,
  type,
  locale: "es" as const,
});

describe("runSearch", () => {
  it("does not search for text that is too short", async () => {
    const { deps } = setup();

    const response = await runSearch(deps, ask(" a "));

    expect(response).toEqual({ results: [], failed: [], source: "short" });
    expect(deps.searchLocal).not.toHaveBeenCalled();
  });

  it("answers from the database alone when it has enough good hits", async () => {
    const search = vi.fn(async () => [media("Never", "movie/99")]);
    const hits = Array.from({ length: enoughLocalHits }, (_, index) =>
      hit({
        id: `l${index}`,
        externalId: `movie/${index}`,
        title: `Dune ${index}`,
      }),
    );
    const { deps } = setup({
      searchLocal: vi.fn(async () => hits),
      providers: [provider("tmdb", search)],
    });

    const response = await runSearch(deps, ask("dune"));

    expect(response.source).toBe("local");
    expect(response.results).toHaveLength(enoughLocalHits);
    expect(search).not.toHaveBeenCalled();
  });

  it("asks the providers when the database has too few good hits", async () => {
    const search = vi.fn(async () => [media("Dune", "movie/7")]);
    const { deps } = setup({
      searchLocal: vi.fn(async () => [hit({ similarity: 0.2 })]),
      providers: [provider("tmdb", search)],
    });

    const response = await runSearch(deps, ask("dune"));

    expect(response.source).toBe("providers");
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("normalizes the query before using it", async () => {
    const search = vi.fn<MediaProvider["search"]>(async () => []);
    const { deps } = setup({ providers: [provider("tmdb", search)] });

    await runSearch(deps, ask("  Pokémon   GO "));

    expect(deps.searchLocal).toHaveBeenCalledWith("pokemon go", undefined);
    expect(search.mock.calls[0][0]).toBe("pokemon go");
  });

  it("serves a repeated search from the cache without asking a provider", async () => {
    const search = vi.fn(async () => [media("Dune", "movie/7")]);
    const { deps } = setup({ providers: [provider("tmdb", search)] });

    const first = await runSearch(deps, ask("dune"));
    const second = await runSearch(deps, ask("dune"));

    expect(first.source).toBe("providers");
    expect(second.source).toBe("cache");
    expect(search).toHaveBeenCalledTimes(1);
    expect(second.results.map((r) => r.title)).toEqual(["Dune"]);
  });

  it("keeps an empty answer too, so a search with no results is not repeated", async () => {
    const search = vi.fn(async () => []);
    const { deps } = setup({ providers: [provider("tmdb", search)] });

    await runSearch(deps, ask("zzzzzz"));
    const again = await runSearch(deps, ask("zzzzzz"));

    expect(again.source).toBe("cache");
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("merges the database and the providers, and the database copy keeps its id", async () => {
    const search = vi.fn(async () => [
      media("Dune", "movie/1", 2021),
      media("Dune Part Two", "movie/2", 2024),
    ]);
    const { deps } = setup({
      searchLocal: vi.fn(async () => [hit({ similarity: 0.3 })]),
      providers: [provider("tmdb", search)],
    });

    const response = await runSearch(deps, ask("dune"));

    expect(response.results.map((r) => [r.title, r.id])).toEqual([
      ["Dune", "local-1"],
      ["Dune Part Two", null],
    ]);
  });

  it("keeps the answers of the providers that are up when one fails", async () => {
    const down = provider("open_library", async () => {
      throw new ProviderError("open_library", "timeout");
    });
    const up = provider("tmdb", async () => [media("Dune", "movie/1")]);
    const { deps } = setup({ providers: [down, up] });

    const response = await runSearch(deps, ask("dune"));

    expect(response.results.map((r) => r.title)).toEqual(["Dune"]);
    expect(response.failed).toEqual(["open_library"]);
  });

  it("does not keep a partial answer in the cache", async () => {
    const down = provider("open_library", async () => {
      throw new ProviderError("open_library", "timeout");
    });
    const up = provider("tmdb", async () => [media("Dune", "movie/1")]);
    const { deps, raw } = setup({ providers: [down, up] });

    await runSearch(deps, ask("dune"));

    expect(raw.put).not.toHaveBeenCalled();
  });

  it("never waits longer than the deadline for a slow provider", async () => {
    const slow = provider(
      "open_library",
      () => new Promise<NormalizedMedia[]>(() => undefined),
    );
    const fast = provider("tmdb", async () => [media("Dune", "movie/1")]);
    const { deps } = setup({ providers: [slow, fast], deadlineMs: 30 });

    const started = Date.now();
    const response = await runSearch(deps, ask("dune"));

    expect(Date.now() - started).toBeLessThan(1000);
    expect(response.results.map((r) => r.title)).toEqual(["Dune"]);
    expect(response.failed).toEqual(["open_library"]);
  });

  it("still searches the providers when the database fails", async () => {
    const search = vi.fn(async () => [media("Dune", "movie/1")]);
    const { deps, logs } = setup({
      searchLocal: vi.fn(async () => {
        throw new Error("secret connection string");
      }),
      providers: [provider("tmdb", search)],
    });

    const response = await runSearch(deps, ask("dune"));

    expect(response.results).toHaveLength(1);
    expect(logs.join("")).toContain("search.local_failed");
    expect(logs.join("")).not.toContain("secret");
  });

  it("answers with nothing, and does not fail, when there is no database and no provider", async () => {
    const { deps } = setup({
      searchLocal: vi.fn(async () => {
        throw new Error("no database");
      }),
    });

    const response = await runSearch(deps, ask("dune"));

    expect(response.results).toEqual([]);
    expect(response.failed).toEqual([]);
  });

  it("logs how long each provider took, and never the text that was searched", async () => {
    const { deps, logs } = setup({
      providers: [provider("tmdb", async () => [media("Dune", "movie/1")])],
    });

    await runSearch(deps, ask("my private query"));

    const events = logs.map((line) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({
        event: "search.provider",
        provider: "tmdb",
        ok: true,
        type: "all",
        queryLength: "my private query".length,
      }),
    ]);
    expect(typeof events[0].ms).toBe("number");
    expect(logs.join("")).not.toContain("private");
  });

  it("only asks the providers that cover the type", async () => {
    const books = vi.fn(async () => []);
    const films = vi.fn(async () => []);
    const { deps } = setup({
      providers: [
        provider("open_library", books, ["book"]),
        provider("tmdb", films, ["movie"]),
      ],
    });

    await runSearch(deps, ask("dune", "movie"));

    expect(books).not.toHaveBeenCalled();
    expect(films).toHaveBeenCalledTimes(1);
  });
});
