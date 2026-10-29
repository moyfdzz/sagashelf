import type { Locale } from "../providers/types";
import type { SearchResult } from "./merge";
import type { SearchType } from "./normalize";

/** How long an answer is kept: a day, and an hour when the answer was empty (ADR-004). */
export const cacheTtlSeconds = 24 * 60 * 60;
export const negativeCacheTtlSeconds = 60 * 60;

/** What the cache keeps: the answer of the providers to one query. */
export type CachedAnswer = { results: SearchResult[] };

export type SearchCache = {
  get(
    query: string,
    type: SearchType | undefined,
    locale: Locale,
  ): Promise<CachedAnswer | null>;
  put(
    query: string,
    type: SearchType | undefined,
    locale: Locale,
    answer: CachedAnswer,
  ): Promise<void>;
};

// The version in the address changes when the shape of an answer does (v2 added the poster, v3 the authors, v4 the Spanish title of a book), so
// answers kept in the old shape are not read.
// The cache is keyed by a made-up address on a host that never exists. The query is encoded
// into the address, so two queries cannot collide or add parameters to each other.
function keyFor(
  query: string,
  type: SearchType | undefined,
  locale: Locale,
): Request {
  const params = new URLSearchParams({
    q: query,
    type: type ?? "all",
    locale,
  });
  return new Request(`https://search-cache.sagashelf.internal/v4?${params}`);
}

/**
 * The search cache on top of the Workers Cache API. It never throws: a cache that does not work
 * (the Cache API may not run on every host) only means every search goes to the providers, and
 * a broken entry is read as a miss. What it keeps is data from TMDB for one day at most, far
 * inside the six months its terms allow (ADR-016).
 */
export function createSearchCache(cache: Cache | null): SearchCache {
  return {
    async get(query, type, locale) {
      if (!cache) return null;
      try {
        const hit = await cache.match(keyFor(query, type, locale));
        if (!hit) return null;
        const body = (await hit.json()) as CachedAnswer;
        return Array.isArray(body?.results) ? body : null;
      } catch {
        return null;
      }
    },

    async put(query, type, locale, answer) {
      if (!cache) return;
      const seconds =
        answer.results.length === 0 ? negativeCacheTtlSeconds : cacheTtlSeconds;
      try {
        await cache.put(
          keyFor(query, type, locale),
          new Response(JSON.stringify(answer), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${seconds}`,
            },
          }),
        );
      } catch {
        // Not being able to keep an answer costs a later call to the providers, nothing more.
      }
    },
  };
}
