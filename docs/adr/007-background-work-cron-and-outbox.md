# ADR-007: Background work: one Cron Trigger handler and a transactional outbox

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** The handler and the first job (refreshing titles, SAG-54) are done. The outbox, the alert checks and the rollups are planned (SAG-27, SAG-24, SAG-28).
- **Tickets:** SAG-54, SAG-27, SAG-24, SAG-28

## Context

Some work must happen outside a request: delivering webhooks to Discord with retries, checking for new episodes and volumes, and rolling up analytics. A request handler cannot do it reliably: after the response, a Worker may keep running with `waitUntil`, but only for a limited time, and nothing retries it if it fails. The Workers Free plan also allows few scheduled triggers.

## Decision

- **One `scheduled` handler** in the Worker is the only scheduled entry point. It runs every minute and dispatches small jobs: deliver pending outbox events, run due alert checks (SAG-28), and, on their own cadence, the daily analytics rollups (SAG-24). The cron expression lives in `wrangler.jsonc`.
- **A transactional outbox** (the `outbox` table exists since SAG-9, with a unique idempotency key, a status, an attempt count and a next-attempt time, and an index on the pending events that are due; an integration test checks that the event and the change are saved together or not at all). An event (for example "user finished a series") is written to the `outbox` table **in the same database transaction** as the change that caused it. The handler reads pending rows and delivers them, so an event is never lost if the delivery fails and never sent for a change that was rolled back.
- **Delivery rules:** a timeout per call, retries with exponential backoff and jitter (for example 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours), a stop after a number of failures with the endpoint disabled and the owner notified, respect for Discord rate-limit headers, and an **idempotency key per event** so a retry does not post twice.
- **Small batches.** Each run handles a limited number of events and jobs so it finishes quickly, and one failing job never blocks the others.
- **Observability.** Each delivery is logged in `webhook_deliveries` (status, attempt, latency, response code, no secrets).

## Alternatives considered

- **Only `ctx.waitUntil()` after the response.** The Workers documentation (read 2026-10-20) says `waitUntil()` can extend execution for up to **30 seconds** after the response. There is no retry and no record if it fails. Rejected as the delivery mechanism, still fine for small best-effort work.
- **One Cron Trigger per job.** The Free plan allows **5 Cron Triggers per account** (250 on the paid plan), so separate triggers run out quickly. A single handler with a dispatcher uses one.
- **A queue or Durable Objects.** Not evaluated: whether they fit the Free plan was **not verified**. The outbox table gives the same guarantees with the database already in use, and a queue can replace the delivery step later without changing how events are written.
- **An external scheduler such as a CI cron.** Adds a second system and a credential to call the app. Rejected.

## Consequences

**Good**

- Reliable, retried delivery with an audit trail, and no extra infrastructure.
- Adding a new background job means adding a function to the dispatcher, not a new trigger.

**Costs and risks**

- **CPU time on the Free plan is 10 ms per Cron Trigger invocation** (read 2026-10-20). Waiting for the network does not count, but parsing, signing and database work do. Batches must stay small, and the first real deliveries must be measured. The paid plan is the fallback.
- **Latency.** Events are delivered up to a minute after they happen, which is acceptable for Discord posts and alerts but not for anything the user waits for.
- **Polling the outbox every minute** costs database reads even when nothing is pending. The query must be cheap and indexed.

## Open questions

- Whether the 10 ms CPU limit is enough for the rollup job (SAG-24). It may need to be split into small steps across several runs.

## Amendment (2026-10-28, SAG-54): the first job, refreshing titles, and its schedule

The `scheduled` handler now calls `runScheduledJobs` (`server/jobs/scheduled.ts`), which runs the jobs one after another and logs a failure by name without throwing. The first job is `refreshStaleMedia` (`server/jobs/refresh-stale-media.ts`).

- **Schedule: `0 */6 * * *`** (every 6 hours, in UTC), declared in `triggers.crons` of `wrangler.jsonc`. One trigger of the 5 the Free plan allows. The decision above says the handler runs every minute because the outbox needs it; that part is still planned. Refreshing titles does not need it, and every run wakes the Neon compute (it sleeps after 5 minutes, ADR-002), so the trigger is as rare as the job allows. When the outbox arrives it changes the expression and this job keeps its own cadence by checking the time of the run.
- **Batch: 5 titles per run**, so up to 20 a day. A title costs at most: 2 provider calls for the details (Spanish and English), 2 saves, 2 or 3 calls for the seasons of a series (20 seasons per call, ADR-016), 1 to save them and 1 to note a failure, about 8 subrequests. Five titles and the list query stay near 41 of the 50 the Free plan allows per invocation (ADR-001); a series with more than 20 seasons adds one call per 20.
- **Which titles:** the ones whose `fetched_at` is older than 150 days, oldest first, and then the ones with no title or synopsis in Spanish or in English (it fills the language a title was never asked for, SAG-47). The titles people made themselves (`custom`) are left out.
- **Both languages, all or nothing.** Each title is asked for in both languages and saved only when both answers arrive, so a failure leaves it as it was. English is saved first, so the `title` column ends in Spanish, the default.
- **A failure does not stop the batch, and does not block the queue.** A title the provider fails on, or no longer knows, is noted by touching `updated_at` of its external id (`saveMedia` touches it on a success), and it is left out for 24 hours. Without this, the five oldest failing titles would take every run. No new column was needed.
- **Nothing is erased with a null.** `saveMedia` keeps the stored year, poster and status when the source sends none (`unknown` for the status), as it already did with the original title (SAG-50) and the synopsis. A title that lost its original title is repaired when a refresh in the other language brings it; the job does not select titles for that reason alone, because many titles have none on purpose (the source sends none when it equals the title).
- **The 180 days.** TMDB's terms (<https://www.themoviedb.org/api-terms-of-use>, read 2026-10-25, ADR-016) forbid keeping information from TMDB longer than 6 months. 6 months is about 183 days; the code uses 180 (`providerDataMaxAgeDays`) and refreshes at 150, which leaves 30 days to retry a title that fails.
- **Not done:** removing the provider data of a title that could not be refreshed before the limit (ADR-017 lists it). It is a decision about licenses and about what the pages show, and it has its own ticket. A title that fails every day for 150 days is only logged (`media.refresh_failed`, `media.refresh_missing`).
- **Measure it.** The CPU limit of a Cron Trigger on the Free plan is 10 ms (read 2026-10-20). Waiting for the network does not count, but parsing the answers and saving does. The first real runs must be read in Observability (`media.refresh_batch` shows what a run did); if a run is cut short, lower the batch.

## References

- Cloudflare Workers limits, <https://developers.cloudflare.com/workers/platform/limits/> (read 2026-10-20)
- Cloudflare Cron Triggers, <https://developers.cloudflare.com/workers/configuration/cron-triggers/> (read 2026-10-20)
- Tickets SAG-27, SAG-24 and SAG-28 (Linear)

## Update (SAG-90, 2026-10-31)

A second Cron Trigger was added (`30 */6 * * *`) for the next episodes of the series: the first one has no subrequests left for one call per show, and each trigger is an invocation with its own 50. The handler tells them apart by `controller.cron`. The Free plan allows 5 triggers per account, so 2 are used. See [ADR-027](027-tvmaze-next-episode.md).
