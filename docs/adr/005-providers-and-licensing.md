# ADR-005: Data providers, their terms, and the providers we do not use

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Partial: the interface and TMDB are built (SAG-13, see [ADR-016](016-provider-layer-and-tmdb.md)) and the credits page is live (SAG-31); SAG-14, SAG-16 and SAG-17 are planned
- **Tickets:** SAG-13, SAG-14, SAG-16, SAG-17, SAG-31, SAG-33

## Context

SagaShelf shows metadata for anime, movies, series, books and manga that it does not own. Every source has its own license, attribution rule, storage rule and rate limit, and some of them forbid exactly what a tracker with its own database would do. The project is a **personal, non-commercial portfolio**, which several providers require.

## Decision

All sources sit behind one `MediaProvider` interface (SAG-13), so a source can be added, removed or replaced, for example TMDB by another provider if the project ever became commercial. The providers are:

| Provider         | Used for                                | Terms (read 2026-10-20)                                                                                                                                                                                         | Attribution                                                                                                                                                                                                                    | Storage                                                                          | Rate limit                                                                                |
| ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **TMDB**         | Movies, series, anime, images, trending | Free for **non-commercial** use. A project is commercial if its primary purpose is to create revenue for the owner. The terms page itself could not be read (see open questions)                                | TMDB logo and the notice "This product uses the TMDB API but is not endorsed or certified by TMDB" on a credits page (live at `/credits`; the notice wording was confirmed on TMDB's logos and attribution page on 2026-10-25) | Not stated in the FAQ that was read                                              | Not stated in the FAQ that was read                                                       |
| **TVmaze**       | Episode schedules, cross ids            | **CC BY-SA**: usable for any purpose with credit and the ShareAlike condition                                                                                                                                   | A link back to TVmaze                                                                                                                                                                                                          | Images may be cached indefinitely; building a local cache of shows is documented | At least 20 calls per 10 seconds per IP; a `User-Agent` is recommended                    |
| **Wikidata**     | Cross ids (QIDs), franchise relations   | Structured data is **CC0** (public domain)                                                                                                                                                                      | Not required, but requested ("Powered by Wikidata")                                                                                                                                                                            | No rule stated; CC0 implies none                                                 | 429 responses must be respected; send a good `User-Agent` and `Accept-Encoding: gzip`     |
| **Open Library** | Books                                   | No license named; the Internet Archive claims no new rights over the database. The APIs are **not meant to be a bulk backend or high-traffic commercial infrastructure**                                        | Not stated                                                                                                                                                                                                                     | Cache responses; no bulk downloads (use the monthly dumps instead)               | 1 request per second, 3 per second when identified with `User-Agent` and an email         |
| **Google Books** | Books (fallback)                        | Google APIs Terms plus the Books terms: **no charging users** without permission, **no building databases or permanent copies** of returned content beyond the cache headers, and removal of content on request | Google's attribution and branding rules                                                                                                                                                                                        | **Not persistent**: cache only as long as the cache headers allow                | Per-API quotas, numbers not stated on the pages read                                      |
| **MangaDex**     | Manga (metadata only)                   | Free only for projects that **credit MangaDex, do not run ads or paid services, and do not sell access**. Donations are allowed; the team judges case by case                                                   | Credit MangaDex, and credit scanlation groups if chapters were shown (they are not)                                                                                                                                            | Not stated; images **must be proxied**, hotlinking is refused                    | About 5 requests per second per IP, endpoint limits, a real `User-Agent`, no `Via` header |

### Providers we do not use

- **AniList.** Its terms of use (read from its public documentation repository) say the API is free for non-commercial use, and also: using it as a backup or **data storage** service is prohibited, **hoarding or mass collection** is prohibited, and use "within competing, non-complementary services of the same nature" is prohibited, explicitly including **anime and manga list or tracker services**, for user data and media data. SagaShelf is a tracker that keeps its own catalog, so it falls under all three. The API was also documented as degraded to 30 requests per minute.
- **MyAnimeList.** Its API License and Developer Agreement (2019) requires a Client ID and written permission for commercial applications, limits use to "internal business purposes", forbids combining or integrating the API with other software without written authorization, forbids altering MAL content without written authorization, and forbids obtaining content by any means other than the API. Merging several sources into one normalized catalog conflicts with those clauses. MAL can also change or end the agreement at any time and may audit use.

### Non-commercial status

The project stays non-profit. Concretely: no ads, no paid features, no charging users for access. No ticket plans donations; if they were ever considered, each provider's rule would have to be checked first. This is a requirement of TMDB (non-commercial use) and MangaDex (no ads or paid services), and it keeps the Google Books rule about charging users intact.

### Attribution duties

A credits page (SAG-31) lists every source with its required wording: the TMDB logo and notice, the TVmaze link, "Powered by Wikidata", MangaDex credit, and Google's branding where Google Books content is shown. The page is linked from the footer.

## Alternatives considered

- **Use AniList or MyAnimeList for anime.** Rejected for the reasons above. TMDB covers anime through its TV and movie data.
- **Mirror whole catalogs.** Forbidden or discouraged by several providers and incompatible with ADR-004.
- **One provider only.** Simpler, but no single source covers movies, series, anime, books and manga.

## Consequences

**Good**

- Every source has a documented license, a duty list and a rate limit, and replacing one does not touch the app.
- The tracker does not depend on APIs whose terms it would violate.

**Costs and risks**

- **Optional supporter badge (SAG-33).** A paid supporter feature would conflict with MangaDex's "no paid services" rule and could count as commercial under TMDB's definition. The ticket is marked optional and test-mode only; it should be reconsidered before any real payment is enabled.
- **ShareAlike (TVmaze).** If TVmaze data is stored and republished as part of a dataset, the CC BY-SA condition applies to that derived data. Today the data is shown inside the app, not distributed as a dataset.
- **Google Books is not a catalog source.** Persisted book records must come from another provider.
- **Terms change.** Each provider can change or end its API. The adapter layer and the credits page are the places to update.

## Open questions

- **The TMDB terms page was not readable on 2026-10-20.** It was read on 2026-10-25: caching is limited to 6 months, and the rest is in [ADR-016](016-provider-layer-and-tmdb.md).
- The numeric Google Books quota, the Open Library attribution rule, and the exact MangaDex cover and image rules were not stated on the pages read.
- **Cloudflare's Free plan and commercial use** is not addressed in its public terms (ADR-001). Another reason to keep the project non-commercial.

## References (all read 2026-10-20)

- TMDB FAQ, <https://developer.themoviedb.org/docs/faq>
- TVmaze API, <https://www.tvmaze.com/api>
- Wikidata licensing, <https://www.wikidata.org/wiki/Wikidata:Licensing> and data access, <https://www.wikidata.org/wiki/Wikidata:Data_access>
- Open Library API, <https://openlibrary.org/developers/api> and licensing, <https://openlibrary.org/developers/licensing>
- Google Books terms, <https://developers.google.com/books/terms> and Google APIs Terms, <https://developers.google.com/terms>
- MangaDex API documentation, <https://api.mangadex.org/docs/> and limitations, <https://api.mangadex.org/docs/2-limitations/>
- AniList terms of use, <https://github.com/AniList/docs/blob/main/docs/guide/terms-of-use.md> and rate limiting, <https://github.com/AniList/docs/blob/main/docs/guide/rate-limiting.md> (the published site returned 403, so the public source repository was read)
- MyAnimeList API License and Developer Agreement, <https://myanimelist.net/static/apiagreement.html> (last modified 2019-08-08)
