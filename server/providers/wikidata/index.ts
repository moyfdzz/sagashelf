import { createHttpClient, type HttpClient } from "../http";
import {
  buildLookupQuery,
  buildMembersQuery,
  parseLookup,
  parseMembers,
  type LookupHit,
  type SparqlResult,
  type WikidataItem,
  type WikidataSource,
} from "./map";

const endpoint = "https://query.wikidata.org/sparql";

// Wikidata asks for a good User-Agent, few requests at a time and a low timeout, and to stop on a
// 429 and honor Retry-After (read 2026-10-30). The job makes one or two calls per run.
const requestsPerSecond = 1;

/**
 * The Wikidata client. It is not a `MediaProvider`: it does not search or describe titles, it
 * only tells which other things a title is related to, so the job uses it directly.
 */
export type WikidataClient = {
  /** The item of every source Wikidata knows, in one call. */
  lookup(
    sources: readonly WikidataSource[],
    options?: { signal?: AbortSignal },
  ): Promise<LookupHit[]>;
  /** The members of the franchises and the given items, in one call. */
  members(
    franchises: readonly string[],
    extra: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<WikidataItem[]>;
};

export function createWikidataClient(http: HttpClient): WikidataClient {
  const ask = (query: string, signal?: AbortSignal) =>
    http.getJson<SparqlResult>(
      `${endpoint}?${new URLSearchParams({ query, format: "json" })}`,
      { signal },
    );

  return {
    async lookup(sources, { signal } = {}) {
      const query = buildLookupQuery(sources);
      return query ? parseLookup(await ask(query, signal)) : [];
    },
    async members(franchises, extra, { signal } = {}) {
      const query = buildMembersQuery(franchises, extra);
      return query ? parseMembers(await ask(query, signal)) : [];
    },
  };
}

let cached: WikidataClient | null = null;

/** The client with its rate and the statuses that must stop it. No key is needed. */
export function createWikidataClientWithDefaults(
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
): WikidataClient {
  return createWikidataClient(
    createHttpClient({
      provider: "wikidata",
      headers: { Accept: "application/sparql-results+json" },
      ratePerSecond: requestsPerSecond,
      // The members of a large franchise take up to about 13 seconds together (read 2026-10-31).
      // Waiting costs no CPU, and the endpoint's own limit is 60 seconds.
      timeoutMs: 40_000,
      // A 429 means stop, and do not insist (Wikidata's usage guidelines).
      retries: 0,
      stopOnStatus: [429, 403],
      stopMs: 5 * 60_000,
      ...overrides,
    }),
  );
}

/** One client per Worker instance, so its circuit breaker keeps its state between runs. */
export function getWikidataClient(): WikidataClient {
  cached ??= createWikidataClientWithDefaults();
  return cached;
}
