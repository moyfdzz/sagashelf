# ADR-027: The next episode of a series, through TVmaze

- **Status:** Accepted
- **Date:** 2026-10-31
- **Implementation:** Done (SAG-90).
- **Tickets:** SAG-90, SAG-16, SAG-28
- **Related:** [ADR-005](005-providers-and-licensing.md), [ADR-007](007-background-work-cron-and-outbox.md), [ADR-025](025-wikidata.md)

## Context

A series should show the date of its next episode, and the alerts of new episodes (SAG-28) need it. SAG-16 asked for a TVmaze adapter next to the Wikidata one; the checks of 2026-10-30 showed that TVmaze cannot be asked by a TMDB id (`GET /lookup/shows?tmdb=1396` answers `400`; the lookup takes `imdb`, `thetvdb` and `tvrage`), so the ticket was split and TVmaze became SAG-90. The plan was to get the IMDb id from TMDB (`external_ids`), which needs the TMDB token and could not be read. Checking on 2026-10-31 found a way that needs no token.

Facts read from the services on 2026-10-30 and 2026-10-31 (read-only calls with the shared `User-Agent`):

- **Wikidata has the id of the show in TVmaze.** The property is `P8600` ("TV Maze series ID"; found with `wbsearchentities`). For 12 well-known series looked up by their TMDB id (Breaking Bad, Game of Thrones, Attack on Titan and others) the item had it in all 12, and the id of Attack on Titan (919) is the one TVmaze answers to. The same item has `P345` (IMDb) and `P4835` (TheTVDB). One SPARQL call answered in 0.5 s.
- **`GET https://api.tvmaze.com/shows/<id>?embed=nextepisode`** answers with `status` (`Running`, `Ended`, ...) and, when the show has a next episode, `_embedded.nextepisode` with `airdate` (`YYYY-MM-DD`, in the time of the network), `airstamp`, `season`, `number` and `name`. The Simpsons (83) had season 38 episode 5 on 2026-11-01; Attack on Titan (919) and Breaking Bad (169) are `Ended` with no next episode. A show TVmaze does not know answers 404.
- **Rules** (<https://www.tvmaze.com/api>, read 2026-10-31): at least 20 calls every 10 seconds per IP address and a `429` above it, which asks the client to back off; the answers are cached by the edge for 60 minutes; "use of the TVmaze API is licensed by CC BY-SA", free for any purpose as long as TVmaze is credited as the source and the ShareAlike provision is met.

## Decision

**The id comes from Wikidata, and no call to TMDB is needed.** The lookup query of ADR-025 also asks `P8600`, and the Wikidata job saves it in `media_wikidata.tvmaze_id` with the date it asked (`tvmaze_checked_at`). A series that the job found before it read the id is looked up once more (`findTitlesToLookUp`: a TMDB series or anime with an item and no `tvmaze_checked_at`), 20 a run and at the cost of the same four subrequests. An answer with no id never erases one we hold. The id is **not** saved as a `media_external_ids` row, as the ticket said: the refresh job of titles picks every external id of a title whose `updated_at` is old and skips the ones with no provider, so a `tvmaze` row would take a place of its 5 a run for nothing, which is why Wikidata's item is not one either (ADR-025).

**A table of its own** (migration `0016`, additive): `media_next_episode` has, per title, the id of the show, its status, the date and the exact moment of the next episode, its season, number and name, when it was asked, and **when it is to be asked again** (`next_check_at`). That column is the whole schedule: the job asks for the shows whose time has come, and there is no list to keep. It is catalog data, not a person's, so the account erasure does not touch it, and it is what SAG-28 reads.

**The rhythm of each show** (`nextCheckAt` in `server/providers/tvmaze/map.ts`, set when TVmaze answers):

- With a next episode: the day after it comes out (at noon UTC), but not sooner than six hours and not later than a week, so a date that has already passed is not asked about on every run, and a date months away is still checked weekly.
- Running, or to be determined, with no date: a week.
- Ended, with no status or unknown to TVmaze (404): three months.
- A show that fails (anything but a 429) waits a day and keeps what we knew of its next episode.

**The client** (`server/providers/tvmaze/`): the shared `User-Agent`, a timeout of 8 s, one retry for a 5xx, **two calls a second** (the rule is 20 in 10 s), and a `429` opens the circuit for a minute and is never retried (`stopOnStatus`). The id goes into the address, so it is checked to be a plain number first. Switched on by `TVMAZE_ENABLED=true`, a plain Workers variable, unset in CI and in previews, like the other services.

**A second Cron Trigger** (`30 */6 * * *`, half an hour after the first, in `wrangler.jsonc`). A scheduled invocation shares one budget of 50 subrequests, and the first one already uses up to 49 of them in its worst case (about 41 of the refresh, 4 of the Wikidata job, 4 of the first run of the sagas sync, and the drafts of ADR-026 wait for a quiet run). The next episodes need one call per show, so they run in an invocation of their own: the handler tells them apart by `controller.cron` (`tvmazeCron` in `server/jobs/scheduled.ts`, and a test keeps it equal to the string in `wrangler.jsonc`). A run takes up to **20 shows**: the list, up to 20 calls to TVmaze, and one statement to save the answers and one to put off the ones that failed, so at most 23 subrequests. At two calls a second it waits about ten seconds, which costs no CPU. When TVmaze says 429 or the circuit is open the run stops, saves what it has and puts nothing off. ADR-007 chose one trigger because the Free plan allows 5 per account; this is the second.

**The page** of a series or an anime shows "Next episode: season 2, episode 5 · November 14, 2026" under its status, with the name of the episode when TVmaze gives one, and "Date from TVmaze" with a link. It shows only the day, as the dates of the seasons do (the hour depends on the network's time zone), and only while the date is not more than a day old. A failure of the query hides the line and nothing else. **The credits page** names TVmaze with the license (CC BY-SA) and a link to its terms; the credit is also next to every date shown, which is where the license asks for it.

## Alternatives considered

- **The IMDb id from TMDB** (`append_to_response=external_ids`), then TVmaze's `lookup/shows?imdb=`. It adds a call to TMDB per title (or a field to every title saved) and a lookup call to TVmaze, and it needs the TMDB token to be checked, which an agent must not use. Wikidata gives the id of the show directly and the job already asks it.
- **Put the job in the first Cron Trigger.** It would have 1 to 3 subrequests left, so 1 or 2 shows a run, and every title would take days to be asked once.
- **Ask TVmaze when the page opens.** A slow call in the request, and 20 calls in 10 seconds is a rule that many visitors would break. The page reads a table.
- **A cron every minute.** The shows that are due are few; every six hours is enough for a date that changes rarely, and the Free plan has 5 triggers.
- **The schedule of the whole season** (`/shows/<id>/episodes`). More data than a date and more to keep in step with TVmaze; the next episode is what the page and the alerts need.

## Consequences

**Good**

- A series shows when its next episode comes out, with nothing in the request path and no new key.
- The first run makes no extra call to anybody for the ids: the Wikidata job brings them.
- SAG-28 reads one table.

**To watch**

- **Coverage was measured on 12 series**, all well known. A less known series may have no `P8600`, and then it has no date; how many of a real library are covered is **not measured**. After the first runs, `SELECT count(*) FILTER (WHERE tvmaze_id IS NOT NULL) AS with_id, count(*) AS series FROM media_wikidata mw JOIN media_items m ON m.id = mw.media_id WHERE m.type IN ('series', 'anime')`.
- **TVmaze caches for 60 minutes**, so a date can be an hour old.
- **The date is the one of the network's time zone**, so it can be a day behind or ahead of ours. The page does not show an hour for that reason.
- **Not measured:** the CPU time of the run against the real runtime (10 ms on the Free plan, ADR-007), and that the Worker's outgoing address is not limited by TVmaze (the rule is per IP, and a Worker shares its address). The first runs show it in the logs (`tvmaze.batch`, `job.failed`).
- **The ShareAlike provision** applies if the data is republished as a dataset (ADR-005). Today it is shown inside the app, with the credit.

## Facts that were checked

TVmaze API and its licensing, <https://www.tvmaze.com/api> (read 2026-10-31); the answers of `/shows/<id>?embed=nextepisode` for the shows 83, 919 and 169 (2026-10-31); the Wikidata API (`wbsearchentities`, `wbgetentities` for `P8600`, `P345`, `P4835`) and the SPARQL endpoint (2026-10-31). **Not verified:** the coverage of `P8600` over a real library, the CPU time of the job, and how TVmaze limits the address of a Worker.
