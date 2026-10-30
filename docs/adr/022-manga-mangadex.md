# ADR-022: Manga through MangaDex

- **Status:** Accepted
- **Date:** 2026-10-28
- **Implementation:** Done (SAG-66). The volumes of a manga are SAG-68, the genres and tags SAG-71 (done, see [ADR-024](024-genres.md)) and the choice to show adult material SAG-70.
- **Tickets:** SAG-66, SAG-68, SAG-70, SAG-71
- **Related:** [ADR-005](005-providers-and-licensing.md), [ADR-016](016-provider-layer-and-tmdb.md), [ADR-017](017-media-pages-and-image-proxy.md), [ADR-021](021-books-open-library.md)

## Context

Manga is the last format of the first release that had no source. MangaDex is the only one in ADR-005 that fits (AniList and MyAnimeList were rejected there). Its rules are the strictest of the providers, so they are written here with the date they were read, 2026-10-28 (<https://api.mangadex.org/docs/> and <https://api.mangadex.org/docs/2-limitations/>):

- **Free only for projects that follow three rules.** "You MUST credit MangaDex." "You CANNOT run ads or paid services on your website and/or apps." The documentation also says "you must not be profiting from our API" and not to "sell access to anything provided by the MangaDex API". Donations are allowed. Exceptions "may be made for legitimate services".
- **Removal requests must be honored.** "As we do honor such requests, you must in turn honor them": a request that asks "to make their works unavailable on your platform".
- **The request MUST have a `User-Agent` that is not spoofed, and CANNOT have a `Via` header.** Checked: an image request with no `User-Agent` answers `400`.
- **About 5 requests per second per address**, for all of `*.mangadex.org`. Above it the answer is `429`, and "continuing to send requests after 429s" can get the address banned (`403`), and then the server stops answering it. They "will drastically throttle you" if many requests could be one.
- **Images:** "We will serve the wrong response for any image hotlinked from our domains", and "you MUST proxy the requests your users make to our services". Checked: a request with a foreign `Referer` returns a different image.
- The pages read say **nothing about caching, or about the chapters of scanlation groups** beyond crediting them if chapters are shown (they are not).

Shape of the API (answers recorded on 2026-10-28): `GET /manga?title=` with `includes[]=cover_art`, `author` and `artist` brings the covers and the names in the same answer. The title is often only in romaji, and the English or Spanish one is an alternative title. The description comes in several languages, in Markdown, and often ends with a rule (`---`) followed by credits and links. The cover is `uploads.mangadex.org/covers/<manga id>/<file>`, and the thumbnails add `.256.jpg` or `.512.jpg` to the file name (also for a PNG). There are no redirects.

## Decision

- **The adapter** is `server/providers/mangadex/` behind `MediaProvider`: kind `manga`, no parts, no trending. The id is the uuid of the manga. A search is one call (20 results, by relevance) and a title is one call. **It never asks for chapters** (`getParts` answers an empty list).
- **The title** is the one in the language of the visitor when the title or an alternative title has it (`es` or `es-la`, `en`), then English, then the title MangaDex lists, then any alternative. The title MangaDex lists is kept as the original title when it differs. Both descriptions (`es` and `en`) are filled from the same answer, as Markdown cut at the first rule, with links turned into their text.
- **Authors** are the names of the author and artist relations, once each, in `creators` (ADR-021).
- **Only `safe` and `suggestive`.** The search asks for those two ratings and the mapping refuses the others too, so a title opened by its id does not get around it. Adult material is a decision of the person, not of the code: SAG-70 (an account setting for every provider). Nothing adult is saved today, so nothing has to be filled in later. MangaDex classifies some well-known series as adult (checked: the series of Miura Kentaro), and those do not appear.
- **Genres and tags** were dropped at first. SAG-71 reads the tags of the groups genre and theme and maps them to our own list of genres; no tag of MangaDex is stored ([ADR-024](024-genres.md)).
- **Never banned.** The client keeps to 4 requests per second. A `429` or a `403` is **never retried and opens the circuit at once for 60 seconds** (`stopOnStatus` in `server/providers/http.ts`; for the other providers a `429` is still retried). A Worker shares its outgoing address with others, so MangaDex may count calls that are not ours; this is the case that matters, and the search then answers with the other providers and says that some sources did not answer.
- **Covers through the image proxy**, as the terms require (ADR-017). The proxy file is `<manga id>_<cover file>`; the sizes of 92 and 185 px use the 256 thumbnail and the rest the 512. The proxy sends the shared `User-Agent` to this provider (it asks for one), follows no redirect, and **spaces its calls to 4 per second** with a turn per call, so the 20 covers of a page of results do not go out at once (a call that would wait more than 3 seconds answers `429` with `Retry-After`). A cover served from the Cache API takes no turn.
- **Removal requests** are a list in the code, for every provider and not only this one: `server/providers/removed.ts`, keys `provider:externalId`. A title in the list is left out of the search, answers "not found" when opened, and its cover is not served (not even from the cache). The list is empty until a request arrives. Procedure when one does: (1) add the key and deploy; (2) delete the saved row, which is the owner's decision because it also deletes the library entries that point to it (`DELETE FROM media_items WHERE id IN (SELECT media_id FROM media_external_ids WHERE provider = 'mangadex' AND external_id = '<id>')`); (3) answer the request.
- **Switched on by `MANGADEX_ENABLED=true`**, like Open Library: a plain Workers variable, unset in CI and in previews. The search shows the manga tab only when a provider covers it.
- **Credit.** The credits page has a section for MangaDex with a link, says that only metadata is used, that there are no chapters, no ads and no paid features, and that covers are shown through SagaShelf and not stored. The title page links to the manga at MangaDex and names it in the foot.

## Alternatives considered

- **A table for the removals.** It lets a title be removed without a deploy, but adds a query to the search and to every title page. Removals are expected to be rare. When they are not, or when the admin dashboard exists (SAG-26), it moves to a table.
- **Filtering adult material with an account setting now.** It is a feature of its own (age confirmation, a flag on each title, the search cache key, the privacy policy), for every provider: SAG-70.
- **Using the 5 requests per second.** It leaves no margin when the address is shared.
- **Hotlinking the covers.** Refused by MangaDex: they get another image.
- **Retrying a `429`.** What ADR-016 does for TMDB. Here it is what the terms say leads to a ban.

## Consequences

- Manga can be searched, opened, added to the library and refreshed by the same code as the rest. The cron job (ADR-007) asks MangaDex twice per title (once per language) although the answer is the same; it fits, since each call is far from the 5 per second.
- The first time a page of results is shown, its covers appear one after another (4 a second) and are then kept a day.
- If MangaDex limits the shared address, manga disappears from the search for a minute at a time and the rest of the search keeps working.
- MangaDex data has no popularity, so the order of manga is MangaDex's own relevance.

## Open questions

- **The cover and image rules** are the ones of the documentation read on 2026-10-28; the cache rule for covers is not stated. The proxy keeps a cover one day.
- **Whether `uploads.mangadex.org` counts toward the 5 requests per second** is not stated. The proxy assumes it does.
- **Hiatus** has no status of ours, so it is shown as unknown.
- **Whether a Worker's address is limited in practice.** Not seen yet; watch the log lines `media.refresh_failed` and the search `failed` list for `mangadex`.

## References

- MangaDex API documentation, <https://api.mangadex.org/docs/> (read 2026-10-28)
- MangaDex limitations and requirements, <https://api.mangadex.org/docs/2-limitations/> (read 2026-10-28)
