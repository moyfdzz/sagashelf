# ADR-025: Other formats of a story, through Wikidata

- **Status:** Accepted
- **Date:** 2026-10-31
- **Implementation:** Done (SAG-16). TVmaze and the next episode date were split into SAG-90.
- **Tickets:** SAG-16, SAG-90, SAG-25, SAG-28
- **Related:** [ADR-005](005-providers-and-licensing.md), [ADR-007](007-background-work-cron-and-outbox.md), [ADR-016](016-provider-layer-and-tmdb.md), [ADR-022](022-manga-mangadex.md), [ADR-024](024-genres.md)

## Context

SAG-16 asked for two adapters, TVmaze and Wikidata, so that a series shows its next episode and a work links to its other formats. Checking the services on 2026-10-30 (read-only calls with the shared `User-Agent`) showed two things:

- The ticket was wrong about TVmaze: `GET /lookup/shows?tmdb=1396` answers `400`. The lookup accepts `imdb`, `thetvdb` and `tvrage` and answers a `301` to `/shows/<id>`. TMDB gives those ids only through `external_ids`, which needs the TMDB token and was **not verified**. Its rules (20 calls per 10 s per IP, CC BY-SA, a link back) and its data (the next episode changes every week) differ from Wikidata's. The owner accepted the split: **TVmaze is SAG-90**, and SAG-28 (alerts) now depends on it.
- Wikidata knows the graph that sagas (SAG-25) need. The franchise `Q106712785` (Attack on Titan) has 23 members with the property "media franchise": the manga, the anime, the film, spin-offs, light novels and video games. **Books are irregular**: the Open Library work ids of Dune (`OL893414W`) and another returned no row for `P648`, so book coverage is not promised.

## Decision

**What Wikidata gives us** (properties read from the Wikidata API on 2026-10-30): the item of a title, found by its id in a source we use (TMDB movie `P4947`, TMDB series `P4983`, MyAnimeList manga `P4087`, AniList manga `P8731`, Open Library `P648`), its labels in Spanish and English, its media franchises (`P8345`) and the works it is based on (`P144`). The members of a franchise come with their class (`P31`), which tells the format: anime, movie, series, manga, book, game or other (`formatOfClass` in `server/providers/wikidata/map.ts`, classes checked in the API on the same day). **There is no MangaDex property in Wikidata** (searched), so a manga is found through the ids MangaDex itself gives: the record has `attributes.links` with `al` (AniList) and `mal` (MyAnimeList), for example `al: 30002`, `mal: 2` for Berserk (read 2026-10-30). The MangaDex mapper now keeps them in `NormalizedMedia.crossIds`. Without this an anime and its manga would stay apart.

**Three small tables** (migration `0013`, additive):

- `wikidata_items`: the item (`Q...`), its labels per language, its format and the ids it has in our sources. Catalog data, not a person's, so the account erasure does not touch it.
- `wikidata_links`: `franchise` and `based_on` between two items. There is no foreign key: a link can arrive before the item at its end, and a page only lists the items it knows.
- `media_wikidata`: that a title was looked up and which item it is. A null item says "Wikidata does not know it", and it is asked again after 30 days.

**One column**, `media_items.cross_ids` (`jsonb`, with a GIN index): the `mal` and `anilist` ids of a manga. `NULL` means the source was never asked, `{}` means it was asked and gave none; the job that already refreshes titles fills the manga saved before (the same pattern as the genres, ADR-024), and a save that brings none never erases the ids we hold.

**This is not a `media_external_ids` row.** The plan was to keep the item as an external id with the provider `wikidata`. A miss needs a place to be remembered, and that table allows one title per id (two titles of ours can be the same Wikidata item), so `media_wikidata` holds it. The value `wikidata` of the enum stays unused.

**A job in the 6-hourly cron** (`server/jobs/enrich-wikidata.ts`, dispatched from `runScheduledJobs` after the refresh), never in the request of a visitor. The ticket says "outbox", but the outbox is not built (it needs the every-minute cron, SAG-27), so this follows the pattern of ADR-007. A run takes up to **20 titles** that were never looked up (the ones in somebody's library first), and makes **two calls to Wikidata whatever the number of titles**: one SPARQL query that finds the item of every title with its labels, franchises and base works (a `VALUES` block per source and a `UNION` between them), and one that brings the members of those franchises and the works they are based on, with their labels, classes and ids. On 2026-10-30 one batched query resolved five TMDB titles in 0.3 s and 3.7 KB, and the members of the franchise above came back in 1.8 s and 1 KB (a `GROUP BY` gives one row per member). The result is saved in **one statement** (the items, the links and the titles looked up), so a run costs **4 subrequests** in all (the list, two calls, the save), next to the roughly 41 of the refresh job; the invocation shares a budget of 50. When Wikidata fails nothing is saved and the same titles are tried again on the next run. A franchise with more than 400 members is cut at 400 (`LIMIT`), which is a known limit.

**Polite use**: the shared `User-Agent`, a timeout of 15 s, no retry, and a `429` or `403` opens the circuit for five minutes and is never insisted on (`stopOnStatus`). Wikidata's guidelines (<https://www.wikidata.org/wiki/Wikidata:Data_access>, read 2026-10-30) ask for a good `User-Agent`, `Accept-Encoding: gzip,deflate` (the runtime's `fetch` negotiates it), few requests at a time, the lowest sensible timeout, and to stop on a `429` and honor `Retry-After`. Only plain ids reach a query: every value is checked against the shape of its source before it is written into the text (a test tries to inject).

**Switched on by `WIKIDATA_ENABLED=true`**, a plain Workers variable like the other providers, unset in CI and in previews, so no test reaches the real service. It is not in `wrangler.jsonc` (`keep_vars` keeps it).

**The title page** shows "Otros formatos de esta historia" under the seasons, grouped by format. It lists everything Wikidata knows: the titles our catalog already holds are links (matched by the item they were looked up as, by their TMDB or Open Library id, or by the MyAnimeList or AniList id of a manga), and the rest are plain text with their name. The list is the other members of the franchises and the works the title is based on or that are based on it, up to 60. A failure of the query hides the list and nothing else. The credits page names Wikidata ("Powered by Wikidata", requested and not required, ADR-005).

**No new origin in the CSP**: Wikidata is called only from the server.

## Alternatives considered

- **Keep both sources in SAG-16.** Two sets of rules and a volatile data set that needs a refresh rhythm of its own; the ticket was also wrong about how TVmaze is queried. Split.
- **Show only what is already in the catalog.** It would be nearly empty at first, because the catalog holds only what has been opened.
- **Leave manga for later.** An anime and its manga would stay apart, which is the heart of the feature for the owner.
- **Ask Wikidata when a page is opened.** It would put a slow external call in the request. A page reads the tables only.
- **Store the item as an external id.** See above.
- **One query per title.** The cron shares 50 subrequests; a batch costs the same for 1 title or 20.

## Consequences

**Good**

- A title shows its other formats with no call in the request, and sagas (SAG-25) can build on the franchise and `based_on` links without a new call.
- Four subrequests per run, however many titles.

**To watch**

- How much of the real library Wikidata knows is **not measured**: after the first runs, `SELECT count(*) FILTER (WHERE qid IS NOT NULL), count(*) FROM media_wikidata;`.
- Whether the job fits the CPU limit of a scheduled invocation (10 ms on the Free plan, ADR-007) was **not measured** against the real runtime; the first runs show it in the Cloudflare logs (`wikidata.batch`, `job.failed`).
- A title Wikidata knew is not refreshed afterwards: a new film added to a franchise later appears only for titles looked up after it. A periodic re-check is a later change.
- The matching of the classes to formats covers the common ones; an item with another class is listed under "Otros".

## Facts that were checked

Sources read on 2026-10-30 and 2026-10-31: the Wikidata API (`wbgetentities`, labels of the properties and classes), the SPARQL endpoint `https://query.wikidata.org/sparql` (the queries above), <https://www.wikidata.org/wiki/Wikidata:Data_access>, <https://www.wikidata.org/wiki/Wikidata:Licensing> (CC0), the MangaDex API record of a manga (`attributes.links`), and the TVmaze API (<https://www.tvmaze.com/api>) for the split. **Not verified:** TMDB `external_ids` (needs the token); the cost of the job in CPU time.
