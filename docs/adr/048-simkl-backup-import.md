# ADR-048: A Simkl JSON backup is imported through its TMDB ids, not through the Simkl API

- **Status:** Accepted
- **Date:** 2026-11-10
- **Implementation:** Partial (SAG-242: the converter; the notice when an import finishes is the second PR)
- **Tickets:** SAG-242
- **Related:** [ADR-005](005-providers-and-licensing.md) (AniList and MyAnimeList rejected), [ADR-047](047-import-queue.md) (the queue)

## Context

People who track in Simkl have a backup file (`SimklBackup.json` with the lists `shows`, `anime` and `movies`). It has no `schemaVersion`, no `libraryEntries` and no SagaShelf source. The ids it carries are Simkl, TMDB, IMDb, TVDB and, for anime, MyAnimeList, AniList, AniDB and Kitsu. Our providers can only be asked by a TMDB id (series, movies and anime), a TVmaze, Open Library or MangaDex id.

A file with 1,541 entries was counted on 2026-11-10 (ids only, no titles kept): every show and movie had a TMDB id; 114 of 152 anime had one; 3 of the 38 without it had an IMDb or TVDB id and 35 had only anime ids.

## Decision

- The file is detected by its shape (a list `shows`, `anime` or `movies` and no `libraryEntries`) and **converted in memory** to the entries of our own export by `server/library/import-simkl.ts`. The converted entries go through the same Zod schema, duplicate check, limits (5 MB, 5,000 entries counted across the three lists) and queue as any other file. Nothing about Simkl is stored.
- Only the TMDB id is used. An anime whose `anime_type` is `movie` is a TMDB movie; a series, an OVA or an ONA is a TMDB series. Status: `completed`, `plantowatch` (planned), `watching` (in progress), `hold` (paused), `dropped`. Episodes watched become the progress; a rating outside 1 to 10 is read as none; the finish date is the last-watched day of a completed title. Simkl has no start date or notes, and everything imported is private.
- An entry without a TMDB id is left out with the reason `no_source` and listed with its title and year, so the person can add it by hand. Matching by IMDb or TVDB (TMDB `/find`), by title and year, or through MyAnimeList, AniDB or Kitsu ids is left to SAG-243.
- **The Simkl API is not used.** Read on 2026-11-10 (<https://api.simkl.org/api-rules.md>, <https://api.simkl.org/authentication.md>): its rules say the catalog endpoints are not a free metadata source for a competing tracker that does not integrate Simkl; reading a person's list needs that person's token; the data must link back to Simkl. Its Terms (<https://simkl.com/about/policies/terms/>) answered 403 and were not read.

## Consequences

- A backup of mostly anime can leave many titles out (35 of 1,541 here). The page lists them; SAG-243 decides what to do.
- The conversion runs on each step of the import (the file is sent again at each one, as for our own files). Its CPU cost for 1,541 entries was not measured on the Worker.
- A Simkl backup weighs about 2 KB for each title (posters, slugs and ids): the file of 1,541 entries was 3.2 MB, so one of about 2,500 titles passes the 5 MB limit and is refused. The limit was not raised here because the same number sizes the body of the request and the payload that travels back at each step; a bigger one needs its own decision.
- Anime types other than `movie` are all asked of TMDB as a series. The types seen in the one file were `tv`, `movie`, `ova` and `ona`; a type we have not seen (a special, a music video) could point at a TMDB movie and would be listed as not found.
