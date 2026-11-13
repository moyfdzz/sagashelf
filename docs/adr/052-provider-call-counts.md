# ADR-052: The calls to the providers are counted by day, in memory first and written once after the response

- **Status:** Accepted
- **Date:** 2026-11-13
- **Implementation:** Done (SAG-26: the counter, the table `provider_calls_daily` and the page `/admin/stats/providers`)
- **Tickets:** SAG-26

## Context

The admin dashboard (SAG-26) has to answer "what is failing". For the providers (TMDB, Open Library, MangaDex, TVmaze, Wikidata) nothing was kept: the HTTP client knew how long each call took and how it ended, and threw it away. Four facts shaped the decision:

- Every call to a provider goes through one place, `createHttpClient` in `server/providers/http.ts`, so one hook sees all of them.
- A write for every call would double the database work of a search, and the Cron Triggers share 50 subrequests each ([ADR-001](001-runtime-react-router-on-workers.md), the budget in `docs/agent-notes.md`).
- The Neon Free plan pauses the compute after 5 minutes without a query and gives 100 compute hours a month ([ADR-012](012-neon-over-supabase.md)): a write that only exists to count something must never be the query that keeps it awake.
- Workers do not share memory, and an instance may end at any time.

## Decision

- **What is counted.** For each call that goes through the client, the provider, how it ended (`ok`, `http_4xx`, `http_429`, `http_5xx`, `http_other`, `timeout`, `network`, `invalid`, `rate_limited`, `circuit_open`, `cancelled`), the requests really sent (a retry is one more) and the milliseconds. `rate_limited` and `circuit_open` are calls that our own limit or circuit stopped, so their time is not added; `cancelled` is a call the app gave up on (the search does it with a slow provider): it is counted with the requests it sent and the time it waited, because a slow provider is what the page is for. Nothing else is kept: no address, no search text, no header, no error message.
- **In memory first.** `recordProviderCall` (`server/providers/call-log.ts`) adds each call to a count of the Worker instance, by UTC day, provider and outcome. It cannot fail the call: a count that throws is lost and nothing more.
- **Written once, after the answer.** `flushProviderCalls` writes the totals in ONE statement (`saveProviderCalls`, `jsonb_to_recordset` and `ON CONFLICT ... DO UPDATE` that **adds** to the row, since several instances write the same day). The Worker runs it with `waitUntil` after a response that left something counted **and in which the instance used the database** (`wasDatabaseUsed` in `server/runtime-env.ts`, set by `getDb` and cleared by the flush after it writes), and after each Cron Trigger. A request that only called a provider (the worldwide list of `/trending`, for example) leaves its count in memory for a later write, so the write is never the query that wakes the compute of Neon. The flush also runs when the handler throws. It never throws; a failure is logged by name and the counts go back to the memory of the instance for the next flush (their number is bounded by days x providers x outcomes). A provider name that the table would refuse is not counted at all, so one bad row cannot make every write fail.
- **The table** `provider_calls_daily` (migration `0036`): one row for each day, provider and outcome, kept forever (about 5 providers x 10 outcomes x 365 days at most, and far fewer in practice). The outcomes and the shape of a provider name are `CHECK`s, so the list of outcomes lives in `server/db/schema/providers.ts` and a new outcome needs a migration, like the dimensions of the analytics ([ADR-050](050-analytics-collector.md)).
- **The page** `/admin/stats/providers` (administrators only, windows of 7, 30 and 90 days that end today, UTC) shows the calls, the share that failed, the average time, the requests, a table for each provider with the busiest day, how the calls ended and the failed calls for each day with a table of numbers. It says the numbers are approximate and when the counts start.
- **What counts as a failure on the page.** A call that did not get a good answer: a timeout, a network error, an answer that is not valid, a 429, a 5xx, a redirect, or a call that our own limit or circuit stopped. A 4xx such as a 404 is an answer (the client counts the provider as up) and a `cancelled` call is not the provider's fault: neither is a failure. The average time is over the calls that our own limit or circuit did not stop.
- **Subrequests.** The write is 1 subrequest for an invocation that called a provider. `refreshSubrequestBudget` went from 41 to 40 so that the first Cron Trigger stays at most 49 of 50 with the write; the budgets in `docs/agent-notes.md` were updated.

## Alternatives considered

- **Write every call.** Exact, but one more statement for every call (up to 3 for a search, more in a job) and no room in the first Cron Trigger.
- **Count the cache hits of `/trending` at the edge.** It was the first idea. A hit is a request that reads no database at all (that is its purpose), so writing it would be the only query of that request and would keep the compute awake with every visit; keeping it only when something else flushes would make the hit rate look low, because the misses are the ones that call a provider. It is not counted, and the page says so.
- **Show a percentage of a quota.** No provider gives a daily quota to compare with (TMDB, Open Library and the others only ask for a rate per second, which the client already keeps). The page shows the requests of the busiest day instead.
- **A log of every call, with the address.** More to read when something breaks, but the address of a call can hold the text of a search, which the analytics never keep ([ADR-050](050-analytics-collector.md)).

## Consequences

- The numbers are approximate: an instance that ends before it writes loses a few counts, a call made after the response was sent (background work) waits for a later write, and a request that only called a provider waits for one that used the database. For a personal portfolio, that is fine and the page says so.
- The counts start on the day of the deploy. Before it there is nothing, and the page says which day is the first.
- Adding a provider needs no change here: the name comes from the client (`provider` option). Adding an outcome needs a migration and a line in `providerOutcomes`.
- **Migration `0036` goes before the merge**, with the pull request open: the page reads the table, and the write is safe without it (it fails by name and is dropped) but the page is not.

## Open questions

- The cache hits of the edge copy of `/trending` and the titles that were answered from our own database without calling a provider are not measured. Both need a place to count that does not write to the database on every request (for example the analytics collector, which already writes).
- How many times a person reached the limit of new titles of the day ([ADR-035](035-saving-a-title-needs-a-session.md)) is not counted either.
