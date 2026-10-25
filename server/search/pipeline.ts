import type { LocalHit } from "../db/search-local";
import { searchAll } from "../providers/search-all";
import type { Locale, MediaProvider, ProviderId } from "../providers/types";
import type { SearchCache } from "./cache";
import {
  mergeResults,
  rankResults,
  toResult,
  type SearchResult,
} from "./merge";
import { normalizeQuery, queryMinLength, type SearchType } from "./normalize";

/** Titles that match this well count as "good hits" that need no provider. */
const goodSimilarity = 0.6;
/** This many good hits from the database answer the search without asking a provider. */
export const enoughLocalHits = 5;

export type SearchResponse = {
  results: SearchResult[];
  /** Providers that did not answer in time or failed. The results are then incomplete. */
  failed: ProviderId[];
  /** Where the answer came from, for the metrics and for tests. */
  source: "short" | "local" | "cache" | "providers";
};

export type SearchDeps = {
  searchLocal: (
    normalizedQuery: string,
    type: SearchType | undefined,
  ) => Promise<LocalHit[]>;
  providers: readonly MediaProvider[];
  cache: SearchCache;
  deadlineMs?: number;
  /** One line per event, as JSON. Never the text that was searched. */
  log?: (line: string) => void;
};

function localToResult(hit: LocalHit, locale: Locale): SearchResult {
  return toResult(
    {
      type: hit.type,
      title: hit.title,
      originalTitle: hit.originalTitle,
      year: hit.year,
      synopsis: hit.synopsis,
      imageUrl: null,
      status: "unknown",
      popularity: hit.popularity,
      externalId: { provider: hit.provider, id: hit.externalId },
    },
    locale,
    "local",
    hit.id,
  );
}

/**
 * The search, in the order of ADR-004: our own database first, then the cache, then the
 * providers in parallel. A part that fails (the database, the cache, one provider) is skipped
 * and the others still answer. What the providers send is not stored here: a title is saved when
 * somebody opens it or adds it.
 */
export async function runSearch(
  deps: SearchDeps,
  input: { query: string; type: SearchType | undefined; locale: Locale },
): Promise<SearchResponse> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const { type, locale } = input;
  const normalized = normalizeQuery(input.query);
  if ([...normalized].length < queryMinLength) {
    return { results: [], failed: [], source: "short" };
  }

  let hits: LocalHit[] = [];
  try {
    hits = await deps.searchLocal(normalized, type);
  } catch (error) {
    // Without the database the search still goes to the providers.
    log(
      JSON.stringify({
        event: "search.local_failed",
        error: (error as Error).name,
      }),
    );
  }
  const local = hits.map((hit) => localToResult(hit, locale));

  const good = hits.filter(
    (hit) => hit.exact || hit.similarity >= goodSimilarity,
  );
  if (good.length >= enoughLocalHits) {
    return {
      results: rankResults(local, normalized),
      failed: [],
      source: "local",
    };
  }

  const cached = await deps.cache.get(normalized, type, locale);
  if (cached) {
    return {
      results: rankResults(mergeResults(local, cached.results), normalized),
      failed: [],
      source: "cache",
    };
  }

  const outcome = await searchAll(
    deps.providers,
    normalized,
    { type, locale },
    { deadlineMs: deps.deadlineMs },
  );
  for (const timing of outcome.timings) {
    log(
      JSON.stringify({
        event: "search.provider",
        provider: timing.provider,
        ms: timing.ms,
        ok: timing.ok,
        queryLength: normalized.length,
        type: type ?? "all",
      }),
    );
  }

  const fromProviders = outcome.results.map(({ item }) =>
    toResult(item, locale, "provider"),
  );
  // Only a complete answer is kept: a partial one would hide the titles of the provider that failed.
  if (outcome.failures.length === 0 && deps.providers.length > 0) {
    await deps.cache.put(normalized, type, locale, { results: fromProviders });
  }

  return {
    results: rankResults(mergeResults(local, fromProviders), normalized),
    failed: outcome.failures.map((failure) => failure.provider),
    source: "providers",
  };
}
