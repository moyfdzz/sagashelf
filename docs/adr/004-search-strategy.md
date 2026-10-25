# ADR-004: Search strategy: local first, parallel typed fan-out, fallbacks, caching

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Partial (SAG-15): movies, series and anime through TMDB. Books and manga wait for SAG-14, and the "search more sources" button for a second provider. See "How it was built" at the end.
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

## How it was built (SAG-15, 2026-10-25)

- **The pipeline** is `server/search/pipeline.ts`: normalize, the database (`server/db/search-local.ts`), the cache (`server/search/cache.ts`), then `searchAll` to the providers (`server/providers/search-all.ts`), merge and rank (`server/search/merge.ts`). Each part that fails (the database, the cache, one provider) is skipped and the others still answer.
- **Local search** uses the `simple` full-text document, with the last word allowed to be unfinished (`one pie` finds `One Piece`), and `pg_trgm` similarity (`pokemn` finds `Pokémon`), on titles and original titles without accents. Titles of type `custom` never come out of it. "Enough good hits" means five titles that are exact or at least 0.6 similar; fewer than that, and the providers are asked too.
- **The cache** keeps what the providers answered for one query, type and language: one day, and one hour when the answer was empty. A partial answer (some provider failed) is not kept, because it would hide the titles of the one that failed. It is the Workers Cache API behind a wrapper that never throws, so a host without it just has no cache.
- **The deadline** is 3 s for the whole search, passed to every provider as a signal and also raced against it, so a provider that ignores the signal cannot hold the search. Each provider keeps its own timeout and circuit breaker (ADR-016).
- **Metrics** are one JSON line per provider and search (`search.provider`, with the provider, milliseconds, whether it answered, the type and the length of the query). The text that was searched is never logged. The admin dashboard (SAG-26) will read them from Workers Logs.
- **The page** `/search` works without JavaScript (a plain GET form). With it, suggestions come from the same page after 350 ms without typing and from two characters, in a combobox with a list: arrows, Enter, Escape. A result has no link yet, because the detail page is SAG-17. It shows no poster either: the CSP allows only our own images, and posters go through the proxy of SAG-17.
- **Limits:** the query is 2 to 100 characters, `SEARCH_LIMITER` allows 60 searches a minute per caller (only a real search counts, not the empty page), and the page is never kept by a shared cache.
- **Checked against the real TMDB** on 2026-10-25 from a local preview with the owner's token: `dune` returned 40 titles in Spanish, with years, original titles and synopses.

### Still open

- **The Cache API on `sagashelf.app`** (and on `workers.dev`) has not been checked in production. The code works either way; to see whether it caches, search the same term twice and compare the `search.provider` lines in Workers Logs: the second search should write none.
- **Persisting what a person opens** (step 6) belongs to the detail page (SAG-17) and the library (SAG-18). Until then the database stays empty and every new query goes to TMDB once a day at most.
- **Load tests** (k6) are left to SAG-30, when there are several providers and real data.
