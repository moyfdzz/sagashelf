# ADR-051: The favorites of SagaShelf are computed on request, from public things only

- **Status:** Accepted
- **Date:** 2026-11-12
- **Implementation:** Partial (SAG-23: this ADR covers the server function of the site's favorites, PR 1. The worldwide list from TMDB and the public `/trending` page are the next two pull requests)
- **Tickets:** SAG-23, SAG-26

## Context

SAG-23 asks for "best of" lists: what the people of SagaShelf added, completed and rated most, per type and period. The ticket proposed computing them from daily rollups. Three facts shaped the decision:

- SagaShelf is a personal portfolio with few people, and a library entry is private until its owner chooses otherwise. A list built from everything would have to ignore that choice (it breaks what `/privacy` promises), and with few people a small threshold lets a reader infer what one friend keeps private.
- A stored snapshot does not follow a person who later makes an entry private or deletes the account ([ADR-014](014-account-deletion-erases-everything.md)): the old numbers would still include them.
- The cost is small: the numbers are read from `library_entries`, which has a partial index on public entries, and the page will be cached for an hour at the edge in the next pull request.

## Decision

- **What counts.** Only a library entry whose `visibility` is `public` that belongs to a person whose profile is `public`, and not an erased account. Both checks ask `canView` as a signed-out visitor ([ADR-031](031-social-graph.md)), so the privacy policy stays written once. A title that a person made for themselves (`custom`) never counts (the SAG-196 rule, `sharedTitleSql`).
- **Minimum.** A title appears in a list only when **at least 3 different people** stand behind it (`minPeople`).
- **Three lists per type and period.** Most added (by the day the entry was created), most completed (by the finish date the person wrote; an entry with no date is in no period) and best rated. A score has no date of its own, so it counts on the finish date or, without one, on the day the entry was created.
- **Best rated is a Bayesian average**: `(v * R + m * C) / (v + m)`, with `R` the mean of the title, `v` its number of ratings, `C` the mean of every eligible rating of the same type and period and `m = 5` (`bayesianWeight`). A title of three tens does not beat a title with many good scores. The plain mean is returned too, so a page can show it.
- **Periods.** The last 7, 30 or 365 days up to and including today (UTC), or a whole calendar year. Rolling windows, so the first day of a week or month does not start with an empty list.
- **On request, no rollup table.** One function, `getSiteFavorites` in `server/db/site-favorites.ts`, runs ONE statement and returns the three lists (10 titles each). It is the only place that knows the rules, so a rollup or another cache can replace its body later and the admin dashboard (SAG-26) reuses it as is. The 1 hour copy at the edge (the Workers Cache API) is added where the page is served, in a later pull request.

This changes the ticket on purpose: "computed from library activity in daily rollups" became "computed on request". The owner agreed on 2026-11-12.

## Alternatives considered

- **Daily rollups** (the ticket). Cheaper per read, but they keep a copy of what people later withdraw, they need a table, a job and an erasure path (and the cron invocations are full, see the subrequest budget in `docs/agent-notes.md`), and for a few people the read is already cheap.
- **Count every entry, public or not.** More data at the start, but it contradicts the privacy policy and could reveal one person's private entry; the owner accepted "public only" after this was explained.
- **A smaller minimum.** With few people, one or two would be identifiable. 3 is the least that cannot point at a single person.
- **The plain mean.** Three tens would top every list.

## Consequences

- A change of mind (an entry made private, an account erased, a profile locked) shows in the next answer, with no cleanup job.
- At the start the lists will be mostly empty, because few entries are public. The page needs an empty state, and the worldwide part (TMDB) keeps it useful.
- The cost grows with the number of public entries of a type. The statement reads each type through the partial index; if it ever gets slow, a rollup can be added behind the same function, as long as it still honours withdrawals.

## Open questions

- Whether to count a rating by the day it was given needs a new column (`rated_at`). Not worth a migration until someone asks.
- Books and manga: the site's lists work for them (they are types like the others); the worldwide list for books needs a separate look at Open Library's terms, and manga has no popularity source.

## References

- [ADR-014](014-account-deletion-erases-everything.md), [ADR-016](016-provider-layer-and-tmdb.md) (TMDB data may be kept at most 6 months), [ADR-031](031-social-graph.md).
