# ADR-016: The provider layer and TMDB

- **Status:** Accepted (refines [ADR-005](005-providers-and-licensing.md) for TMDB)
- **Date:** 2026-10-25
- **Implementation:** Done for the interface, the HTTP client and the TMDB adapter (SAG-13). The search (SAG-15) and the detail pages (SAG-17) call it.
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
- **The 6-month rule.** `media_items.fetched_at` (migration `0006`) holds when a provider last gave us the row, and `saveMedia` sets it on every refresh. `findStaleMedia` lists the titles older than 150 days (30 days before the limit) so a job can refresh them. The job that does it runs from the Cron Trigger (SAG-54, [ADR-007](007-background-work-cron-and-outbox.md)). A title that a person has in their library is refreshed, never deleted, because deleting it would delete the entries that point to it.
- **Saving is atomic and safe under concurrency.** `saveMedia` is one statement that claims the external id first (the unique index makes a second request wait and then update), so the same new title arriving together makes one row. `saveParts` is one statement too.
- **Posters** are stored as the TMDB image URL (size w500). They are shown only through the image proxy of SAG-17 ([ADR-017](017-media-pages-and-image-proxy.md)), which serves them from our own origin, so the CSP did not need another origin. Nothing in a browser calls TMDB.

## Alternatives considered

- **Keep TMDB data forever.** Simpler, but it breaks the 6-month rule. Rejected.
- **Store only ids and fetch every time.** It keeps no TMDB data, but the search and the library would depend on TMDB for every page and would go down with it. Rejected: the 6-month cache is allowed.
- **The v3 API key in the query string.** TMDB accepts it, but a key in a URL ends up in logs and error messages. The read access token in a header avoids that.
- **One request per season.** Simpler, and it would break the subrequest limit on a long series.

## Consequences

- Everything TMDB gave us has an age, and something has to refresh it before 6 months. The Cron Trigger refreshes the titles older than 150 days, and a visit to a title page refreshes it too (ADR-017).
- If the TMDB license ended, all rows from TMDB would have to be removed or have their TMDB fields cleared. The external ids make them easy to find.
- The breaker and the limiter are per instance. If TMDB ever answers 429 in practice, a shared counter (a Durable Object or KV) is the next step.
- A title is stored in the language it was fetched in (`title`) and its synopsis is kept per language. Fetching it in the other language later adds that synopsis and replaces the title with the newer one.

## Open questions

- Whether TMDB treats a search engine of our own over a cache as a "derivative". The terms do not say; the cache is within the 6 months.
- Posters: the terms do not address images beyond the ban on using TMDB as an image host. The proxy of SAG-17 must not store them.
- The credits page and the logo are SAG-31. Until it exists, the notice is not shown anywhere, and nothing calls TMDB yet.

## Update (SAG-185, 2026-11-10)

The shared client reads an answer with a byte limit (5 MB by default, `maxBodyBytes`): a body over it is refused as `invalid` without being read to the end, and the image proxy does the same with its 2 MB. A call can pass a Zod `schema` with the fields that are read; an answer that does not fit it is a `ProviderError` of kind `invalid`, is not retried and does not count against the circuit. TMDB uses it (a title needs an `id`, a list of results must be a list). The other clients are not validated yet. TMDB allows 15 MB, because the seasons of a long series come with their episodes. An `invalid` answer closes the circuit like a 404 does: the provider answered. Wikidata labels are cut at 300 characters.

## Update (SAG-180, 2026-11-11)

Capacity of the 6-month rule, measured on the production database on 2026-11-11: 252 titles have TMDB data, all fetched less than 30 days ago, and the oldest `fetched_at` is 2026-10-31. The refresh job takes 5 titles per run and the first cron runs 4 times a day, so at most 20 titles a day. A title is a candidate at 150 days, which leaves 30 days before the 180 day limit: about 600 titles. 252 titles are refreshed in about 13 days, so the rule is met today without a code change. The first titles reach 150 days around 2027-03-30.

Two gaps remain, and SAG-180 stays open for them. If many more titles are saved (the open question of 300 new titles a day in ADR-035), the 600 title margin is passed within days and the batch size or the order of candidates must change first. A title TMDB no longer has (a 404) is retried every 24 hours with no limit and keeps its TMDB data past 180 days; the rule for it is not written yet.

## Update (SAG-180, rule for a title TMDB no longer has, 2026-11-11)

When the refresh job asks TMDB for a title that is past 150 days (`refreshAfterDays`) and TMDB answers 404, the job removes what TMDB sent (`removeProviderData`) instead of retrying it every 24 hours for ever. The synopsis, authors, length, genres, poster and popularity are emptied, and the titles and air dates of its seasons and episodes too. The row, its names in both languages and its parts stay, so the library entries that point to it, including those of people who hold it, are not lost. This holds for a title in a library as well: the 6 months rule goes first.

The row is left as "asked, nothing known" and `fetched_at` is set to now, so it leaves the batch and is asked again only after another 150 days; if TMDB has it back by then, it is filled again. A title younger than 150 days that TMDB answers 404 is still retried every 24 hours, and an error that is not a 404 never removes anything. Sizing the batch for the 300 titles a day of ADR-035 is not part of this rule and stays open.

## Update (SAG-180, sizing of the refresh, 2026-11-11)

What the refresh can carry, from the code as it is today. The refresh runs in the first Cron Trigger (`0 */6 * * *`, 4 times a day) with 5 titles a run, so **20 titles a day**. Four of the 5 Cron Triggers the Free plan allows are in use, and each invocation has its own 50 subrequests (limits read in ADR-001 on 2026-10-20; read them again before relying on them).

A title is refreshed again every 150 days, so the refresh must carry as many titles a day as are first saved a day, once the first ones reach 150 days (the first TMDB titles do around 2027-03-30):

| Titles saved a day | Refreshes needed a day, from day 150 | Against 20 a day |
| ------------------ | ------------------------------------ | ---------------- |
| 20                 | 20                                   | no margin        |
| 50                 | 50                                   | 2.5 times short  |
| 100                | 100                                  | 5 times short    |
| 300                | 300                                  | 15 times short   |

300 is the daily cap of one person (ADR-035), not the expected total. Today 252 titles are held. The other limit is a burst: titles saved together become due together, and in the 30 days between day 150 and day 180 the refresh carries 600, so a single import of more than 600 TMDB titles passes the 6 months for the rest.

What happens past the limit is not silent any more: a title TMDB still has but that was not refreshed in time keeps its data past 180 days (the gap this update does not close), and a title TMDB no longer has is emptied by the rule above.

Levers, in the order they cost least; none is chosen:

1. A fifth Cron Trigger for the refresh alone (the last one the Free plan allows): it has its own 50 subrequests, so as many titles a run as the first one, and every 30 minutes would carry about 240 a day. It keeps the Neon compute awake more often (ADR-012).
2. The paid Workers plan: more subrequests per invocation, so a bigger batch. Read its limits when it is decided.
3. Fewer provider calls a title: each title asks TMDB twice (one a language). One call with both languages would nearly halve the cost; the answer of TMDB for that has to be checked.
4. Refresh only the titles that are in a library or were visited, and empty the rest as the 404 rule does. It needs a decision on what a catalog title nobody holds should show.

The decision stays with the owner, and no code changes until the real rate of new titles is known. `server/db/title-budget.ts` already says how many titles each person saved a day, so the rate can be read after some weeks of use.
