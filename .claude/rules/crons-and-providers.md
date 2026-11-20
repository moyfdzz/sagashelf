---
paths:
  - "workers/**"
  - "server/jobs/**"
  - "server/providers/**"
  - "server/webhooks/**"
  - "server/db/episode-alerts.ts"
  - "server/db/import-queue.ts"
  - "server/db/next-episodes.ts"
  - "wrangler.jsonc"
---

# Crons, jobs and providers

## Subrequest budget (read before adding a job)

A scheduled invocation shares **50 subrequests** (every database statement and every outgoing call); each Cron Trigger is its own invocation. The CPU limit is 10 ms on the Free plan. Keep the **Neon compute hours** in mind (100 CU-hours a month, a pause after 5 minutes without a query).

- **First (`0 */6 * * *`):** the refresh of titles (about 41), Wikidata (4), the sagas sync (1 idle, 4 the first time), the saga drafts (1). An invocation that called a provider also writes the count of those calls (`flushProviderCalls`, ADR-052): 1 more, so `refreshSubrequestBudget` is **40** and the first one is at most **49 of 50**. Nothing else may be added without lowering that budget.
- **Second (`30 */6 * * *`):** deletes old picture upload records, old contact messages and finished import jobs, rolls up the analytics of the days that are over and deletes raw events past 13 months (1 each, always), then the next episodes (at most 23): 28, plus the provider count: 29.
- **Third (`15 * * * *`):** `announceNewEpisodes` (1), then webhook delivery (claim 1, each event 2, clean-up 1; 20 events are 42): **43 of 50**, never measured under a full load. With the webhooks off it does not open the database. It calls no provider, so no count.
- **Fourth (`5,20,35,50 * * * *`, ADR-047):** the import queue, at most **46** (claim, budget, providers, the lookups and writes of two people, finish), and **47** with the count. A title looked up by name and year (ADR-049) costs up to 8 requests more and takes 3 of the 5 places of a run (`matchRowWeight`): mind it before raising `rowsPerRun`.

A new job that needs more goes in an invocation of its own (the Free plan allows 5 Cron Triggers; **4 are used**) or cuts something; fold database work into an existing statement as a CTE when you can.

## Jobs

- **`announceNewEpisodes`** (`server/db/episode-alerts.ts`, ADR-030) is ONE statement with data-modifying CTEs: it marks episodes whose `air_stamp` passed, queues one digest per endpoint, writes the notifications and prunes after 30 days. Who hears: an entry `in_progress` with the title's switch on and an endpoint that is on and asked for `episode.aired`. In-app notifications stop with `WEBHOOKS_ENABLED=false` (SAG-183).
- **In a queue job, mark a row done only after its write succeeded, and catch the failure per person** (SAG-241): each person's work has its own try/catch that counts a try on the rows, so one error does not stop the others and a row that always throws reaches `failed`. Units of a daily budget taken for a call that was never made go back.
- **A test of a pause asserts the exact time**, not only that the row waits: a claimed row is leased 15 minutes, so a row paused until midnight also "waits" (compare `retry_at` with the midnight expression).

## Providers (sources and dates are in the ADRs)

Open Library about 3 requests a second; MangaDex about 5 a second, credit required, never called from the browser; TMDB data kept at most 6 months; Wikidata is CC0, stop on a 429; TVmaze is CC BY-SA, at least 20 calls every 10 seconds, credited; **Discord** (ADR-029): content up to 2000 characters, a 429 has `retry_after`, and a webhook that answers 404 must not be used again. Outgoing calls go to fixed hosts and never follow a redirect blindly.
