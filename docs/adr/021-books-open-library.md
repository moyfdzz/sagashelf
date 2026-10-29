# ADR-021: Books through Open Library

- **Status:** Accepted
- **Date:** 2026-10-28
- **Implementation:** Done for Open Library (SAG-14). MangaDex is SAG-66, Google Books SAG-67 and the volumes of a manga SAG-68.
- **Tickets:** SAG-14, SAG-66, SAG-67, SAG-68
- **Related:** [ADR-005](005-providers-and-licensing.md), [ADR-016](016-provider-layer-and-tmdb.md), [ADR-017](017-media-pages-and-image-proxy.md), [ADR-007](007-background-work-cron-and-outbox.md)

## Context

Until now SagaShelf only knew movies, series and anime (TMDB). The ticket for books and manga had three providers in it (Open Library, Google Books, MangaDex). They have different rules, so it was split on 2026-10-28: this record covers Open Library, the one that can be stored.

Open Library needs no key. Its rules, read on 2026-10-28 (<https://openlibrary.org/developers/api>, <https://openlibrary.org/developers/licensing>, <https://openlibrary.org/dev/docs/api/covers>):

- **3 requests per second** when each request carries a `User-Agent` with the application and a contact, 1 per second otherwise. Violations "may result in aggressive rate limiting or blocking".
- **Cache responses** whenever possible. Do not use the API to download the catalog in bulk (use the monthly dumps), do not scrape pages, do not make hundreds of single-book requests, do not use it as the backend of a high-traffic commercial service.
- **Licensing:** the Internet Archive claims no new rights over the database. The pages read name **no attribution or storage rule**; a courtesy link back is "appreciated" for covers.
- **Covers:** `covers.openlibrary.org/b/id/<cover id>-<S|M|L>.jpg`. Lookups by cover id and by Open Library id are not rate limited; lookups by ISBN and other ids are limited to 100 requests per IP every 5 minutes. The cover does not answer directly: it redirects to `archive.org`, and that one to a server of its own (checked on 2026-10-28).

## Decision

- **The adapter** is `server/providers/open-library/` behind `MediaProvider`: kind `book`, no parts, no trending. A work is `OL893414W` (the id the search sends without `/works/`). The search is one call to `search.json` with only the fields we read; opening a work is two calls (`/works/<id>.json` for the description, and the search by `key:/works/<id>` for the authors, cover and year, which the work does not carry).
- **Nothing is downloaded in bulk.** A search is cached by the pipeline (ADR-004), a work is fetched only when somebody opens it or the cron job refreshes it (5 titles per run, ADR-007), and the client keeps to 3 requests per second with the shared `User-Agent`.
- **Authors** are a new column, `media_items.creators` (jsonb, nullable, migration `0009`), because a book without its author is hard to tell from another. It is a list of names in the order the source gives. Like the year, the poster and the original title, a refresh that brings none never erases the ones we hold.
- **Descriptions** have one language (mostly English). The adapter fills `en` whatever language was asked, and a Spanish page falls back to it with the text marked `lang="en"`. The search results carry no synopsis.
- **Duplicates.** Open Library sometimes files the same book as several works. When two have the same title and the same first author, the one with more editions stays. `normalizeIsbn` (`server/providers/isbn.ts`) validates and converts ISBN-10 and ISBN-13 and is shared by every book source: a query that is an ISBN is searched as `isbn:<13 digits>`.
- **A work that was merged or deleted** answers `null` (not found), and the stored row is not touched. Following the redirect would save the other work's id under this row.
- **Covers** go through the image proxy like the posters (ADR-017), so no browser calls Open Library and the CSP does not change. Only the cover id lookups are used (never ISBN, which is limited). The proxy now follows a redirect, which it refused before, but only for a provider that lists the hosts it may go to: for Open Library `archive.org` and its subdomains, over `https`, no port, no credentials, at most 3 hops, each one checked again. TMDB lists none, so for it a redirect is still refused.
- **Switched on by a variable.** The adapter needs no secret, so `OPEN_LIBRARY_ENABLED=true` turns it on (a plain Workers variable in Production, `.dev.vars` locally). CI and previews do not set it, so no test reaches the real service. The search shows the books tab only when a provider covers books.
- **Credit.** The credits page names Open Library with a link back and says that covers are shown through SagaShelf and not stored. No logo is required.

## Alternatives considered

- **Always on.** Simpler, but the end-to-end tests in CI would call `openlibrary.org` for real and depend on its availability.
- **A secret as the switch.** It is not a secret; a variable says what it is.
- **Following any redirect in the proxy.** It would turn the proxy into a way to reach any host. A list per provider keeps the rule that the host is written in the code.
- **Authors inside the synopsis or the original title.** No column to add, but the data would be lost to the search and the page.
- **Cover by ISBN.** It works for editions, but it is rate limited at 100 requests per IP every 5 minutes, which the proxy would use up.
- **Following a merged work.** See above: it would put two ids on one row.

## Consequences

- Books can be searched, opened, added to the library and refreshed by the same code as the rest.
- A work costs two provider calls to open, and the cron job asks twice (once per language) although Open Library answers the same. The cost is inside the 50 subrequests of a run (about 4 calls and 2 saves per book), but a batch made only of books uses less than a batch of series.
- The cover of a book costs up to three subrequests in the image route, one invocation each, far from the limit.
- Open Library stores nothing about the person: the search text is sent to it from our servers (see the privacy policy, SAG-65).
- The popularity of a book is its number of editions, capped at 100. It only orders books among themselves; mixed with TMDB (an "all" search) the order of equal titles is not meaningful.

## Open questions

- **The cover redirect chain** was checked once, on 2026-10-28. If Open Library moves its covers to another domain, covers stop until the list of hosts is updated (the proxy answers `502`).
- **The language of a description** is assumed to be English. A description in another language is shown as English.
- **Whether `archive.org` rate limits our proxy.** The cached image is kept one day; watch for `502` in the image route.
- **The Cache API on previews and production** for the search results of books has not been checked (as in ADR-004).

## Amendment (2026-10-29, SAG-75): the title in Spanish

Open Library names a work with one title, usually the original, so a Spanish page showed "The Butterfly Garden" for a book that has Spanish editions. What was tried on 2026-10-29, with real requests (a few, with the shared `User-Agent`), and what was chosen:

- **The `lang` parameter of the search** does not change the edition that comes back: with and without `lang=es` the `editions` field held the English one. It is still sent, and it is not what gives the Spanish title.
- **A search limited to the works asked for and to `language:spa`** (`(key:/works/A OR key:/works/B) AND language:spa`, fields `key,editions,editions.title,editions.language`) answers in one call with one Spanish edition per work. `editions.rows` did not return more than one. Some titles are noisy ("Dune / Duna", "El Mesias De Dune/Dune Messiah", "Casa Capitular Dune/ Chafterhouse Dune").
- **`/works/<id>/editions.json`** lists every edition with its `languages`; for the example work, 3 of 11 are in Spanish ("El Jardín de Las Mariposas" and two "El jardín de las mariposas"). One call per work.

Decision, only when the site is in Spanish (nothing changes in English):

- **A search** makes one more call for all the works of the page that list `spa` in `language` (the field was added to the search). Having one edition per work, a noisy title is dropped and the work keeps its own. If the call fails, the titles Open Library gave are kept.
- **Opening a work** (and so a refresh by the cron job) makes one more call, to the editions of the work, when its `language` lists `spa`. The title most of the Spanish editions share wins, ignoring capitals. If that call fails, the book is saved with its own title.
- **The rules** (`pickSpanishTitle`): ignore empty titles, the original title (also with other capitals or accents) and titles with a slash, parentheses or brackets; the same title in other capitals counts as one; the most common wins; a tie is no answer and the original title stays.
- **What is saved:** the Spanish title goes in the title of the language asked (`titles.es`), and the title Open Library gave goes in `original_title`, so it is shown under the Spanish one in the search. The English title is saved by the visit or the refresh in English, as before. No migration.
- **Cost:** a search of books in Spanish goes from 1 to 2 provider calls, opening a work from 2 to 3. The cron job asks twice per book (once per language), so it adds at most one call per book in Spanish, 5 per run. All far from the 50 subrequests of a request.
- The search cache key is now `v4`, so an answer kept before this change (English titles) is not read.
- The synopsis stays in English with its language mark; a Spanish one needs another source (SAG-67).
- **Not checked:** the cron job and a real refresh against Open Library. The pick was run on the recorded answers only.

## References

- Open Library API, <https://openlibrary.org/developers/api> (read 2026-10-28)
- Open Library licensing, <https://openlibrary.org/developers/licensing> (read 2026-10-28)
- Open Library covers API, <https://openlibrary.org/dev/docs/api/covers> (read 2026-10-28)
- Open Library search API, <https://openlibrary.org/dev/docs/api/search> (read 2026-10-28)
