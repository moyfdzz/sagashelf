# ADR-007: Background work: one Cron Trigger handler and a transactional outbox

- **Status:** Accepted
- **Date:** 2026-10-20
- **Implementation:** Planned (SAG-27, SAG-24, SAG-28). The empty `scheduled` handler already exists in `workers/app.ts`.
- **Tickets:** SAG-27, SAG-24, SAG-28

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

## References

- Cloudflare Workers limits, <https://developers.cloudflare.com/workers/platform/limits/> (read 2026-10-20)
- Cloudflare Cron Triggers, <https://developers.cloudflare.com/workers/configuration/cron-triggers/> (read 2026-10-20)
- Tickets SAG-27, SAG-24 and SAG-28 (Linear)
