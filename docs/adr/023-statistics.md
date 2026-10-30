# ADR-023: Statistics of a person, worked out when the page opens

- **Status:** Accepted
- **Date:** 2026-10-29
- **Implementation:** Done (SAG-61). The charts that wait for other tickets are listed under Open questions.
- **Tickets:** SAG-61, SAG-20
- **Related:** [ADR-002](002-data-postgres-neon-drizzle.md), [ADR-016](016-provider-layer-and-tmdb.md), [ADR-018](018-personal-library.md), [ADR-019](019-viewings-history.md), [ADR-007](007-background-work-cron-and-outbox.md)

## Context

The owner asked (2026-10-27) for a page with what a person has watched: titles, episodes, days of content, how many titles got each score, and how many were watched each year. Three facts shaped it.

- **The length of a title was not stored.** TMDB sends the minutes of a movie (`runtime`) and of an episode, but `media_items` and `media_parts` had no column and the mapper dropped them. The Free plan of Workers allows 50 subrequests per request, so the lengths cannot be asked to TMDB title by title when the page opens.
- **The library already holds what is needed to count.** The state, score, progress and dates of each entry (ADR-018) and the earlier viewings with their dates (ADR-019) are in Postgres.
- **A person has tens or hundreds of entries, not millions of rows.**

## Decision

**The numbers are worked out in SQL when the page opens**, from the entries of the person of the verified session (`server/db/stats.ts`, `getStats`). Four statements, whatever the size of the library: the totals, the groups (by type, status, score and year of release), the finished viewings by year and month, and the best scored. Each one filters by the id of the person, taken from the session and never from the address.

**What is counted**

- **Episodes watched** of a series or anime: `progress` of the current run plus, for each earlier viewing, every episode of the title. A completed entry has all its episodes seen (ADR-018), so its `progress` is the total.
- **Times watched** of an entry: its earlier viewings, plus one if it is completed now (the same count as the library card).
- **Minutes watched:** a movie counts its length once for each time watched; a series or anime counts its length of an episode for each episode watched. Dropped, paused and in-progress titles count what was seen. **Minutes planned:** the titles in "planned", a movie once and a series with all its episodes.
- **Books and manga** count pages, chapters and volumes from `progress` and its unit, and no days.
- **Finished by year and by month:** every finished viewing, that is, the finish date of a completed entry and the finish date of each earlier viewing. A finished viewing with no date cannot be placed, so it is counted apart and the page says how many there are. The chart by year of release counts entries and links to the library filter that already exists.
- **Scores:** the mean of the scores given, and how many entries got each score from 1 to 10. A bar leads to `/library?rated=N`, a new filter for exactly that score (the older `score` is "N or more").

**The length is one number per title** (migration `0011`, additive): `media_items.runtime_minutes`, with a check that it is not negative.

- A movie keeps its `runtime`. A series keeps the **average length of the episodes** that say it (`saveParts`), or the average of TMDB's `episode_run_time` when the episodes say nothing. The days of a series are therefore approximate, and the page says so.
- `NULL` means the source was never asked. **`0` means TMDB was asked and does not know it**, so a refresh does not ask again for ever. A refresh that brings no length never erases the one we hold. Only TMDB titles are ever `0`; books and manga stay `NULL`.
- **The titles saved before the column existed are filled by the job that already refreshes titles** (`findMediaToRefresh`, every 6 hours, 5 titles each run): a TMDB title with `NULL` is asked once, and after that it holds a number or `0`. No command is needed.
- **A title with no length is not counted in the days.** The page counts the movies and series that were watched or are planned and have none, and says "N titles have no length yet".

**The charts are SVG drawn by the server**, with no library and no script. Each has a table with the same numbers (`<details>`), the hover and the focus say the value (a native `<title>`), and a chart with links is a group of links while one without them is an image described in words. The colors are tokens in `app.css`, light and dark. The accent is the one hue of the charts that show one series. The five types use the first five slots of the validated categorical palette of the data-visualization guide, checked with its validator in both themes on 2026-10-29 (it passes every gate). **The type colors of the badges were not reused:** in the order of the tabs two neighbours were too close, and in dark mode they were outside the lightness band of a chart mark. In light mode three of the five are under 3:1 against the page, so the legend and the table always write the numbers (the rule the guide gives for that case).

**The page** is `/stats`, private (`Cache-Control: private, no-store`, `noindex`), linked from the account menu. A visitor is sent to sign in like any private page.

## Alternatives considered

- **A running total per type, updated when something is added.** Every route that changes an entry (add, status, "+1", watch again, import, delete) would have to update it, and one that forgot would leave a wrong number with no way to see it. It also could not answer "this year" or "planned" without more totals.
- **Precomputed aggregates updated by the outbox (what SAG-20 described).** It is the answer when a page must load fast with thousands of entries or be public. Here the work is four statements over one person's entries. It is left for when there are public profiles, or if the page is measured slow.
- **Asking TMDB for the lengths when the page opens.** It breaks the 50 subrequests, and the 6-month rule of ADR-016 still applies to what is kept.
- **A length for each episode (`media_parts`).** More exact for a series whose episodes vary, but TMDB does not always send it and it needs a bigger query. The average per title is enough for a summary; it can be added later without undoing this.
- **A chart library.** It adds weight, many draw only in the browser, some need relaxed CSP rules, and the accessibility is usually worse than what plain SVG and a table give. The forms here (columns, one bar, rows, a grid) are simple. A library can be added for one chart that needs zoom or animation.
- **One tooltip written in JavaScript.** The native `<title>` works without script and with the strict CSP; it is plainer.

## Consequences

**Good**

- The numbers are always right: they come from the entries as they are, so no route can leave them behind.
- It needs no job and no new table. The one column is additive and safe to apply before the code.
- The page works without JavaScript and every chart can be read as a table.

**Worse, or new work**

- The days are approximate and wait for the job to fill the lengths: for a few hours after the deploy a title can lack one. The page says how many.
- Each visit runs four statements. At this scale they are cheap; the first thing to watch if the page gets slow is the subquery that counts the episodes of a title.
- A new filter in the library (`rated`) and a second set of colors for types (the charts) must be kept in step by hand with the badge colors if the types change.

## Open questions

- **Not verified:** that TMDB sends `runtime` for the episodes in the season details the job asks for (`append_to_response=season/N`), as its documentation says. It was not read from a live answer because it needs the TMDB token. If it does not, the series use `episode_run_time`, or stay at 0. After the first runs of the job, count the titles with `runtime_minutes = 0` to see.
- **Not built:** the title watched most times, the longest series completed, and genres, studios and authors (they need SAG-71). Statistics on a public profile follow the privacy of each entry and belong to the profile ticket (SAG-21).
- **Not built:** a library filter by the year a title was finished, so the bars by year could be links. Earlier viewings are not entries, so it needs its own query.

## References

- The data-visualization guide used for the form of each chart, the palette and its validator (read 2026-10-29).
- ADR-018 and ADR-019 for what an entry and a viewing hold.
