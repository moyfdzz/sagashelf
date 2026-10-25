# ADR-016: The provider layer and TMDB

- **Status:** Accepted (refines [ADR-005](005-providers-and-licensing.md) for TMDB)
- **Date:** 2026-10-25
- **Implementation:** Done for the interface, the HTTP client and the TMDB adapter (SAG-13). Nothing in the app calls it yet: the search (SAG-15) and the detail pages (SAG-17) do.
- **Tickets:** SAG-13, SAG-15, SAG-17, SAG-23, SAG-31
- **Related:** [ADR-004](004-search-strategy.md), [ADR-005](005-providers-and-licensing.md)

## Context

ADR-005 chose the sources and left one thing open: TMDB's terms page could not be read, so its rules on caching and storage were unknown. They were read on 2026-10-25 (<https://www.themoviedb.org/api-terms-of-use>), and one of them changes the design.

## What TMDB's terms say (read 2026-10-25)

- **Non-commercial use only.** A paid app is commercial. The project stays free and without ads (ADR-005).
- **Attribution:** the TMDB logo, less prominent than ours, and the notice that the product "uses TMDB and the TMDB APIs" and "is not endorsed, certified, or otherwise approved by TMDB". It goes on the credits page (SAG-31).
- **Caching is limited to 6 months.** The terms forbid keeping any information obtained from TMDB longer than that. After the end of the license, all of it, cached copies included, must be deleted.
- **Not allowed:** using TMDB as an image host, making "derivatives" of its content, and using its content to train or validate ML or AI systems.
- **Rate limit:** the developer documentation says about 40 requests per second, not fixed, and asks clients to handle 429 (<https://developer.themoviedb.org/docs/rate-limiting>, read 2026-10-25).

The terms say they can change at any time. This record is true only until the next time somebody reads them.

## Decision

- **One interface, `MediaProvider`** (`server/providers/types.ts`): `search`, `getById`, `getParts`, optional `trending`, the types it covers and the attribution it owes. A source is added or replaced without touching the app. Every provider returns the same `NormalizedMedia`, with its id in the source as `(provider, id)`.
- **A shared HTTP client** (`server/providers/http.ts`): a 2.5 s timeout, up to two retries of a GET with a random pause (200 ms, then 400 ms), a token bucket per provider, a circuit breaker (five transient failures in a row open it for 30 s, then one call tests it), and a `User-Agent` with the app and `contact@sagashelf.app`. Only timeouts, network errors, 429 and 5xx are retried and count against a provider: a 404 or a 401 does not. The state lives in each Worker instance, because instances share no memory, so the limit slows a provider down and is not an exact quota. Errors carry the provider and the kind, never a URL, a header or a body.
- **TMDB** (`server/providers/tmdb/`): movies and series from its two endpoints. **Anime is a classification, not an endpoint:** a movie or series with the Animation genre that was made in Japan (`origin_country` on series, `original_language` `ja` on movies). The external id keeps the kind, `movie/603` or `tv/1396`, because TMDB numbers movies and series separately. Seasons and episodes use `append_to_response` (20 seasons per call), so a long series costs a few calls and not one per season (a Free-plan Worker may make 50 subrequests per invocation). Language is `es-MX` or `en-US`. The token is the **API Read Access Token** and goes in an `Authorization` header, never in the URL, so it cannot end up in an error or a log.
- **The secret** is `TMDB_READ_ACCESS_TOKEN`, a Workers secret, optional in `server/env.ts`. Without it no provider exists and the search answers from the database.
- **An outage degrades, it does not break.** `searchAll` asks every provider that covers the type at once and lists the ones that failed; the others still answer. TMDB asks for movies and series separately, and if one of the two fails the other still answers.
- **The 6-month rule.** `media_items.fetched_at` (migration `0006`) holds when a provider last gave us the row, and `saveMedia` sets it on every refresh. `findStaleMedia` lists the titles older than 150 days (30 days before the limit) so a job can refresh them. **That job does not exist yet:** it belongs to the search and cache work (SAG-15). A title that a person has in their library is refreshed, never deleted, because deleting it would delete the entries that point to it.
- **Saving is atomic and safe under concurrency.** `saveMedia` is one statement that claims the external id first (the unique index makes a second request wait and then update), so the same new title arriving together makes one row. `saveParts` is one statement too.
- **Posters** are stored as the TMDB image URL (size w500). They are shown only through the image proxy of SAG-17, which also needs its own CSP origin in its ticket. Nothing in a browser calls TMDB.

## Alternatives considered

- **Keep TMDB data forever.** Simpler, but it breaks the 6-month rule. Rejected.
- **Store only ids and fetch every time.** It keeps no TMDB data, but the search and the library would depend on TMDB for every page and would go down with it. Rejected: the 6-month cache is allowed.
- **The v3 API key in the query string.** TMDB accepts it, but a key in a URL ends up in logs and error messages. The read access token in a header avoids that.
- **One request per season.** Simpler, and it would break the subrequest limit on a long series.

## Consequences

- Everything TMDB gave us has an age, and something has to refresh it before 6 months. Until the job exists, nothing refreshes it, and nothing reads TMDB yet either.
- If the TMDB license ended, all rows from TMDB would have to be removed or have their TMDB fields cleared. The external ids make them easy to find.
- The breaker and the limiter are per instance. If TMDB ever answers 429 in practice, a shared counter (a Durable Object or KV) is the next step.
- A title is stored in the language it was fetched in (`title`) and its synopsis is kept per language. Fetching it in the other language later adds that synopsis and replaces the title with the newer one.

## Open questions

- Whether TMDB treats a search engine of our own over a cache as a "derivative". The terms do not say; the cache is within the 6 months.
- Posters: the terms do not address images beyond the ban on using TMDB as an image host. The proxy of SAG-17 must not store them.
- The credits page and the logo are SAG-31. Until it exists, the notice is not shown anywhere, and nothing calls TMDB yet.
