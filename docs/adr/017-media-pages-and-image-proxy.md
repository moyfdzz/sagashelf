# ADR-017: Title pages, saving on open, and the image proxy

- **Status:** Accepted
- **Date:** 2026-10-25
- **Implementation:** Done (SAG-17), for TMDB. "Add to library" and the saga link wait for SAG-18 and the sagas tickets.
- **Tickets:** SAG-17, SAG-15, SAG-13, SAG-18
- **Related:** [ADR-004](004-search-strategy.md), [ADR-005](005-providers-and-licensing.md), [ADR-006](006-security-model.md), [ADR-016](016-provider-layer-and-tmdb.md)

## Context

The search (SAG-15) finds titles but a result opens nothing and shows no poster, and the database is empty on purpose: a search saves nothing (ADR-004). SAG-17 gives every title a page and a way to show its poster. Two rules from earlier ADRs shape it:

- TMDB lets us keep what it sends for 6 months at most, and does **not** let us use it as an image host (ADR-016, terms read 2026-10-25).
- The CSP allows only our own images (`img-src 'self' data:`), and a browser must never call a provider (ADR-016).

## Decision

**A title is saved when somebody opens it, not when somebody searches.**

- A result we already hold links to its canonical page `/media/:type/:slug-:id`. The id is our own UUID at the end; the words before it are for people, and a wrong or old slug or type gets a `301` to the canonical address. Slugs use only `a-z`, `0-9` and hyphens, so the address needs no escaping.
- A result that only a provider knows links to `/media/open?provider=tmdb&id=movie%2F603`. That address looks the id up first; if it is not there, it asks the provider (in the visitor's language), saves the title and its seasons with `saveMedia` and `saveParts`, and answers `302` to the canonical page. The provider and the id are validated with Zod (the id may only hold letters, digits and `_ / . -`, 64 characters at most). Asking the provider counts against `SEARCH_LIMITER` (scope `media-open`); finding a title we already hold does not. The address is `Disallow`ed in `robots.txt` and answers `Cache-Control: private, no-store`.
- A `GET` that writes is a deliberate exception: a crawler or a prefetch can save a title by following a link. The damage is bounded, because it saves only a real title from a fixed provider, once, under a rate limit. A `POST` would have broken results opened without JavaScript.

**The page** is rendered on the server: poster, title and original title, year, kind and status, synopsis, seasons with their episodes (in `<details>`), a link to the source and a link to the credits. The synopsis is shown in the visitor's language, or in the other one when that is all we hold (with a `lang` attribute). The meta tags carry the canonical link, Open Graph (`og:type` by kind, `og:image` through the proxy at `w500`) and a `twitter:card`. JSON-LD (`Movie`, `TVSeries` or `Book`) goes in as a `script:ld+json` meta entry; it is a data block, not executable, so the CSP needs no change. The `Movie`/`TVSeries` choice for anime comes from the source id (`movie/…` or `tv/…`).

**Refreshing.** When a title is older than 150 days (30 days before the 6 months TMDB allows), or has no synopsis in the visitor's language and is more than a day old, the loader asks the provider again with `waitUntil`, after answering. The visitor sees what we hold; the next visit sees the fresh data. A failure is logged as `media.refresh_failed` and tried again on a later visit. This is not a cron job: a title nobody opens is not refreshed, and the cron handler (and the removal of provider data that could not be refreshed) is still to do.

**The image proxy** is `/img/:provider/:size/:file`, served from our own origin, so the CSP does not change and no browser talks to a provider.

- The host is written in `server/images/sources.ts` (`image.tmdb.org`), never taken from the request. The provider must be on the list, the size one of `w92 w185 w342 w500 w780`, and the file name `[A-Za-z0-9_-]{1,64}.(jpg|png)`. Anything else is a `404` before any call. There is no way to make it fetch another host (no SSRF).
- Pages never carry a provider URL: `imageSrc()` turns the stored address into `/img/tmdb/w342/<file>`, or into nothing for a host that is not on the list.
- The call to the provider sends no cookies and no custom headers, does not follow a redirect (a `3xx` is refused), times out at 3 s, and the answer must be `image/jpeg`, `image/png` or `image/webp`, not empty and at most 2 MB. A failure is a `404` (the provider has no such image) or a `502`, with `Cache-Control: no-store`.
- It keeps a copy in the Workers **Cache API for one day**, in the browser for one day too. A day is far inside the 6 months TMDB allows. We keep **no** copy in our database, R2 or anywhere else, so SagaShelf is not an image host in the sense of its terms. This is our reading of those terms (they say little about images beyond the ban); asking TMDB support is the only way to be sure.
- `IMAGE_LIMITER` (300 a minute per caller and location, namespaces 1003 and 2003) counts only a call to the provider, not an image served from the cache, because one page of results loads about twenty images.
- A response out of the Cache API has immutable headers, and the Worker adds the security headers to every response, so the proxy sends a copy (`new Response(hit.body, hit)`). This was found by trying it against the real TMDB: the first request worked and the second answered `500`.

**The search** now carries `imageUrl` in every result (from the database or the provider) and shows a poster and a link. The search cache key moved from `v1` to `v2` for this, so answers kept before the change (which have no `imageUrl`) are not read. They are not deleted: they expire on their own within a day.

## Alternatives considered

- **Save every title a search returns.** The database would fill with titles nobody opened and every one would have to be refreshed every 6 months. Rejected (ADR-004).
- **Link a search result straight to the canonical page.** It needs our id, which a new title does not have yet. Opening through `/media/open` keeps the canonical address as the only one that is indexed.
- **Let the browser load posters from `image.tmdb.org`** by adding the host to `img-src`. Simpler, but the provider then sees every visitor (their IP and what they look at), which ADR-016 forbids.
- **No edge cache for images.** Zero risk about "hosting", but every poster would cost a call to TMDB on every visit and load. A one-day cache was chosen; the owner decided it on 2026-10-25.
- **Refresh with a cron job only.** The cron handler is empty today, and refreshing on open is simple and covers the titles people look at.

## Consequences

**Good**

- A title link shows a rich preview, and a title is stored only after a person showed interest in it.
- Posters load from our origin, with a one-day cache, and a provider never sees a visitor.
- The only way to fetch from outside is a list of one host, with the checks above in front of it.

**Costs and risks**

- The first visit to a new title waits for TMDB (one call for a movie, up to three for a long series) before it is redirected.
- Nobody refreshes a title nobody opens, so a row can pass 180 days. Until the cron job exists, a stale row is not removed either.
- ~~The title in the row is that of the last language that saved it, so the title of a page can change with the language of the last person to refresh it.~~ Superseded by the amendment below (SAG-47): the title is kept per language.
- The pages and the proxy were tried against the real TMDB only for the poster and the search. The saving path (`/media/open` and the page) was covered by unit and integration tests and not run against a real database from the app, because the Worker's database client talks to Neon over HTTPS and the local Postgres is not reachable that way. It must be tried on a preview.

## Amendment: titles and synopses by language (SAG-47, 2026-10-26)

A movie first opened in Spanish showed its Spanish title and synopsis to a visitor in English, and the search results showed the Spanish title too.

- `media_items.titles` (migration `0007`, additive, `jsonb` default `{}`) holds the title per language, as `synopsis` already did. `title` stays: the full-text and trigram search read it, and it is the fallback when a language is missing.
- `saveMedia` takes the language the provider was asked for and merges `{[locale]: title}` into `titles`. A source with no synopsis in that language is stored as `""` (key present). A missing key means "not asked yet", an empty text means "asked, nothing there", and an empty text never replaces a synopsis we hold. Every reader treats `""` as no synopsis.
- The first visit to a title in a language it was not saved in waits for the provider, up to 2.5 seconds, and shows the result. If it fails or is slow, that visit shows what we hold and a later one tries again. The refresh near the 6 months stays in the background. Titles saved before this change fill in the first time each is opened in each language.
- The title page, its address and the share tags, the search results from our own database, the library (list, order by title and entry page) and the data export (`titles`) use the title in the language of the visitor, then `title`. The page address follows the language, so the canonical URL of a title can differ between Spanish and English (the old address redirects with a `301`).
- Not changed: the search still matches `title` and `original_title` only. Finding a title by its name in the other language, and showing that name in parentheses, is SAG-49 (it needs the full-text column and its index rebuilt).

## Open questions

- **Lighthouse budgets for a detail page** were not set: Lighthouse is informational in CI, so numbers would only be documentation. A page is one image (about 25 KB at `w342`) and a short list; measure it on the preview.
- **Whether a one-day edge copy of an image is "hosting"** for TMDB (see above).
- **The cron job** that refreshes titles older than 150 days and removes the provider data of one that cannot be refreshed before 180 days.

## References

- Ticket SAG-17 (Linear)
- TMDB API terms of use, <https://www.themoviedb.org/api-terms-of-use> (read 2026-10-25)
- Cloudflare Cache API, <https://developers.cloudflare.com/workers/runtime-apis/cache/> (read 2026-10-20)
- Cloudflare `waitUntil`, <https://developers.cloudflare.com/workers/runtime-apis/context/> (read 2026-10-25)
