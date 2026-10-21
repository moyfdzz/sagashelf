# ADR-004: Search strategy: local first, parallel typed fan-out, fallbacks, caching

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Planned (SAG-15, using SAG-13, SAG-14 and SAG-16)
- **Tickets:** SAG-15, SAG-13, SAG-14, SAG-16, SAG-17

## Context

A purely sequential search (provider A, then B, then C) adds every provider's latency together and fails slowly. Providers also differ in coverage, limits and terms (ADR-005). The app runs on the Workers Free plan, which has a limit of **50 subrequests per invocation** (calls to the Cache API count too), so a search cannot call everything for every keystroke.

## Decision

The pipeline, in order:

1. **Normalize** the query (trim, Unicode NFKC, lowercase, remove accents) and read the selected type (all, anime, movies, series, books, manga).
2. **Search our own database first** (`tsvector` plus `pg_trgm` similarity, with a popularity boost). If there are enough good hits, answer immediately. Target: p95 under 150 ms.
3. **Cache.** An edge cache keyed by query, type and language (about 24 hours) and a negative cache for empty results (about 1 hour).
4. **On a miss, fan out in parallel, only to the providers that cover the chosen type**, each with its own timeout (about 2.5 s) and a circuit breaker. Return what arrived when the overall deadline (about 3 s) is reached.
   - movies, series, anime go to TMDB,
   - books go to Open Library, with Google Books as a sequential fallback,
   - manga goes to MangaDex plus the book providers.
5. **Merge, de-duplicate and rank.** Identity comes from external ids, ISBN and Wikidata QIDs, then title and year similarity. Ranking is exact title, then similarity, then popularity, then the user's language.
6. **Persist only what a user opens or adds**, never by harvesting, and only as far as each provider's terms allow (see the constraints below).
7. An optional "search more sources" action replaces calling every provider every time.

Around the pipeline: per-user and per-IP rate limits, a query length limit, partial-result states in the UI ("some sources did not answer"), and per-provider latency metrics that feed the admin dashboard.

### Constraints that come from the providers' terms

These were read on 2026-10-20 (details and sources in ADR-005) and shape step 6 and step 4:

- **Google Books:** its terms forbid building databases or keeping permanent copies of returned content beyond what the cache headers allow. Google Books is therefore a **display-time fallback**; its content is not persisted as catalog data. Persisted book records come from sources without that restriction.
- **MangaDex:** the API cannot be hotlinked or called from a browser. Images and requests must go through our own proxy, and the request must carry a real `User-Agent`.
- **Rate limits are per IP, and Workers share egress addresses.** TVmaze allows at least 20 calls per 10 seconds per IP, Open Library 1 request per second (3 when identified with a `User-Agent` and an email), MangaDex about 5 per second. Each provider needs its own limiter and breaker.
- **Open Library** asks not to be used for bulk downloads or as a high-traffic backend, which also rules out pre-filling the catalog from it.

## Alternatives considered

- **Sequential fallback across all providers.** Simple, but latencies add up and one slow provider delays everything. Kept only inside one type, where a source backs up another.
- **Always fan out to every provider.** Wastes the subrequest budget, hits rate limits, and shows irrelevant results. Rejected.
- **Copy provider catalogs into our database ahead of time.** Fast searches, but most providers' terms forbid bulk collection or storage (ADR-005), and it would make us a mirror. Rejected.
- **Call providers from the browser.** Would expose keys, and MangaDex does not allow it. Rejected.

## Consequences

**Good**

- Repeated searches are served from the database or cache. A slow or failing provider never blocks the others.
- Provider cost, rate limits and terms are contained behind the adapter layer.

**Costs and risks**

- Several moving parts (cache, breakers, merging) must be tested together: timeouts, an open breaker, and partial results.
- The subrequest limit bounds how many providers and cache calls one search can make, so fan-out stays small and the cache layer should be cheap.

## Open questions

- **Does the Cache API work on `*.workers.dev`?** Cloudflare's documentation says it works on custom domains and does not mention `workers.dev`. Test it on a deployed Worker, or wait for the custom domain (SAG-7), before relying on the edge cache. Without it, the database acts as the cache.
- **Resolved: the Workers Rate Limiting binding works on the Free plan** (SAG-7, checked on a preview), but it is approximate and per Cloudflare location, so it slows abuse down and is not an exact quota ([ADR-011](011-edge-security-and-domain.md)).
- The exact persistence rule per provider, once the TMDB terms page has been read in full (see ADR-005).

## References

- Ticket SAG-15 (Linear)
- Cloudflare Workers limits, <https://developers.cloudflare.com/workers/platform/limits/> (read 2026-10-20)
- Cloudflare Cache API, <https://developers.cloudflare.com/workers/runtime-apis/cache/> (read 2026-10-20)
- Cloudflare Rate Limiting binding, <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/> (read 2026-10-20)
- Provider pages listed in ADR-005
