# ADR-049: An anime with no TMDB id is looked up by its name and year, in the queue

- **Status:** Accepted
- **Date:** 2026-11-10
- **Implementation:** Done (SAG-243)
- **Tickets:** SAG-243
- **Related:** [ADR-047](047-import-queue.md) (the queue and its request budget), [ADR-048](048-simkl-backup-import.md) (the Simkl backup), [ADR-005](005-providers-and-licensing.md) (the providers we may use)

## Context

A Simkl backup lists each season of an anime as an entry of its own, with the year of that season and the name in romaji. TMDB has one series with seasons, whose first year is earlier. 38 of the 1,541 entries of the first real file had no TMDB id (ADR-048) and were listed as not imported. A search with the full name and the year of the entry rarely finds the series: a trailing "Season 3" or a subtitle in romaji can make TMDB answer nothing at all.

Tried on 2026-11-10 against the real TMDB API with the 38 titles of that file, which are not kept in this repository: the full name found a single series that aired in the year for 32; the name without its subtitle and season marker found a single one for 5 more; none was ambiguous. The last one is a movie on TMDB.

## Decision

- The Simkl converter gives an **anime with no TMDB id, a name, a year and a known type** a `match` (`kind`, `title`, `year`) instead of a source. Shows and movies never get one: all of them carry a TMDB id. The entry stays out of the request: the upload only counts it and queues it with the others (ADR-047).
- In the queue, the entry is looked up first and then goes on like any other title (budget, save, write). `matchByYear` of the TMDB provider searches by the full name and reads at most the first 3 candidates. A series fits when one of its seasons aired in the year or the year is inside the range from its first to its last episode; a movie fits when its release year is the year. Only when nothing fits it searches again with the name without a subtitle (after a colon and a space) and without a trailing season marker. **Exactly one fit is accepted. Two fits are not guessed, and nothing fitting means the title is listed as having no catalog id** (the existing reason `no_source`, so no migration).
- Several entries (seasons) that fit one series write one library entry; the others are listed as repeated, and the preview says that several seasons of a series merge into one.
- The request budget: a lookup is at most 8 requests (two searches and three shows), and saving the title is up to 6. A row to look up takes **3 of the 5 places** of a run (`matchRowWeight`), and 14 requests fit in 3 places of 6, so a run stays at 46 of 50. The places add up from the first row and the first that does not fit ends the run, so a run with one such row takes it and one more title or two. A big file of anime therefore waits longer, never exceeds the invocation. The 300 new titles a day (ADR-035) count the saved title, not the lookup.
- A lookup that fails (TMDB does not answer) counts a try like a failed fetch; after 3 tries the title is listed as failed.
- The screen of the titles left out says how many there are ("No se importaron 38 títulos") and folds the list behind that count when there are more than 10; a later page of a long list stays open.

## Alternatives considered

- **Match with the year only when it equals the first year of the series.** Rejected: it is the case the ticket describes as the one that fails.
- **Accept the best of several candidates.** Rejected: a wrong title in a library is worse than a title listed for the person to add by hand.
- **Match in the preview.** Rejected: the preview is a request with 50 requests to spend and must not call the provider (ADR-047).
- **Kitsu, AniDB and MyAnimeList ids.** Rejected again: no provider of ours takes them (ADR-005).
- **A new reason `no_match`.** Not worth a migration of a check constraint: `no_source` ("no catalog id") is true of both.

## Consequences

- Of the 38 titles of the first file, 37 should be found; the one movie depends on the type Simkl gives. They are about 17 distinct series, so the library gains fewer titles than entries listed. This comes from a script run on 2026-11-10, not from the shipped code.
- A title with a very common name can fit one wrong series that aired in that year; the rule only refuses ambiguity it can see inside the 3 candidates read.
- The queue is slower for a file with many such entries: one per run per person, at most 4 runs an hour.
- A hand-edited file of our own export can carry `match` too. It is checked by the same schema, costs the same places, and an entry that has an id uses its id.
