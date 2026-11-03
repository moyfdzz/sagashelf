import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { maskWebhookUrl } from "../webhooks/discord-url";
import type { SubscribableEvent } from "../webhooks/events";
import {
  disableAfterFailures,
  type DisableReason,
  type Outcome,
} from "../webhooks/outcome";

/**
 * What the webhooks of a person and the delivery of their events read and write (SAG-27,
 * ADR-029). Every function is one statement, so each one is atomic on the HTTP client of the Worker,
 * which has no transaction to hold open between two of them. Every statement about a person's
 * endpoints has the id of the person of the session in its `WHERE`.
 */

/** How many endpoints a person may have. */
export const maxEndpointsPerPerson = 3;

/**
 * How long a claimed event is left alone. The claim moves `next_attempt_at` this far, so a run that
 * dies before it records the result does not leave its events to be sent again by the next run at
 * once; they come back after this.
 */
export const leaseMs = 10 * 60 * 1000;

/** How long the log of deliveries, and the events that were delivered or given up on, are kept. */
export const keepDays = 30;

/** An endpoint as the settings page shows it. It never holds the address: only a masked form. */
export type EndpointView = {
  id: string;
  kind: "discord" | "generic";
  maskedUrl: string;
  eventTypes: string[];
  enabled: boolean;
  failureCount: number;
  disabledAt: Date | null;
  disabledReason: DisableReason | null;
  createdAt: Date;
};

const asDate = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));

const isDisableReason = (value: unknown): value is DisableReason =>
  value === "unauthorized" ||
  value === "not_found" ||
  value === "too_many_failures";

/** The endpoints of the person, oldest first. The address is masked here, so no caller can leak it. */
export async function listEndpoints(
  db: SqlExecutor,
  userId: string,
): Promise<EndpointView[]> {
  const { rows } = await db.execute(sql`
    SELECT id, kind::text AS kind, url, event_types, enabled, failure_count,
           disabled_at, disabled_reason, created_at
    FROM webhook_endpoints
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at, id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind === "generic" ? "generic" : "discord",
    maskedUrl: maskWebhookUrl(String(row.url)),
    eventTypes: Array.isArray(row.event_types)
      ? row.event_types.map(String)
      : [],
    enabled: row.enabled === true,
    failureCount: Number(row.failure_count ?? 0),
    disabledAt: row.disabled_at ? asDate(row.disabled_at) : null,
    disabledReason: isDisableReason(row.disabled_reason)
      ? row.disabled_reason
      : null,
    createdAt: asDate(row.created_at),
  }));
}

export type AddEndpointResult = "added" | "limit" | "duplicate";

/**
 * Saves the address of a Discord webhook for the person, unless they have `max` already or this
 * address. The count and the insert are one statement, so two forms sent at once cannot both pass
 * the check on a count one of them has not changed yet, except for the rare race of two statements
 * that read the same count; the limit is there to keep one person from filling the table, not to
 * be exact. `url` must have been through `parseDiscordWebhookUrl`.
 */
export async function addDiscordEndpoint(
  db: SqlExecutor,
  userId: string,
  url: string,
  max: number = maxEndpointsPerPerson,
): Promise<AddEndpointResult> {
  const { rows } = await db.execute(sql`
    WITH have AS (
      SELECT count(*)::int AS total, coalesce(bool_or(url = ${url}), false) AS same
      FROM webhook_endpoints
      WHERE user_id = ${userId}::uuid
    ),
    added AS (
      INSERT INTO webhook_endpoints (user_id, kind, url)
      SELECT ${userId}::uuid, 'discord', ${url} FROM have
      WHERE total < ${max} AND NOT same
      ON CONFLICT (user_id, url) DO NOTHING
      RETURNING id
    )
    SELECT total, same, (SELECT count(*) FROM added)::int AS added FROM have
  `);
  const row = rows[0];
  if (Number(row?.added ?? 0) > 0) return "added";
  if (row?.same === true) return "duplicate";
  return "limit";
}

/** Deletes an endpoint of the person with its log and its events that are waiting. */
export async function removeEndpoint(
  db: SqlExecutor,
  userId: string,
  endpointId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    DELETE FROM webhook_endpoints
    WHERE id = ${endpointId}::uuid AND user_id = ${userId}::uuid
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * What `reenableEndpoint` did. `not_allowed` is an endpoint that exists and is off for a reason that
 * turning it on cannot fix; `not_found` is no such endpoint of the person, or one that is on already
 * (the answer does not say whose an endpoint is).
 */
export type ReenableResult = "enabled" | "not_allowed" | "not_found";

/**
 * Turns an endpoint that was switched off back on, with its count of failures cleared, but only when
 * it was switched off for `too_many_failures` (SAG-105): several failures in a row, such as an outage
 * of Discord, which can pass. An endpoint turned off because Discord says the webhook is gone
 * (`not_found`) or refuses its token (`unauthorized`) would be sent to again, answered the same, and
 * turned off again, since turning it on sends nothing and cannot check that the webhook exists; the
 * person has to remove it and paste a new one. The rule is in the statement and not only on the page,
 * so a form sent by hand cannot go around it. One statement, so the decision and the change are one.
 */
export async function reenableEndpoint(
  db: SqlExecutor,
  userId: string,
  endpointId: string,
): Promise<ReenableResult> {
  const { rows } = await db.execute(sql`
    WITH target AS (
      SELECT id, enabled, disabled_reason
      FROM webhook_endpoints
      WHERE id = ${endpointId}::uuid AND user_id = ${userId}::uuid
    ),
    done AS (
      UPDATE webhook_endpoints
      SET enabled = true, disabled_at = NULL, disabled_reason = NULL,
          failure_count = 0, updated_at = now()
      WHERE id IN (SELECT id FROM target)
        AND NOT enabled AND disabled_reason = 'too_many_failures'
      RETURNING id
    )
    SELECT (SELECT count(*) FROM done)::int AS done,
           (SELECT count(*) FROM target
             WHERE NOT enabled AND disabled_reason IS DISTINCT FROM 'too_many_failures')::int AS refused
  `);
  if (Number(rows[0]?.done ?? 0) > 0) return "enabled";
  // Read before the change, so two clicks at once do not make the second one "not allowed": the
  // second sees a reason that was fine and finds the endpoint on.
  if (Number(rows[0]?.refused ?? 0) > 0) return "not_allowed";
  return "not_found";
}

/**
 * Saves which events an endpoint of the person receives (SAG-28). The list replaces the old one, so
 * an empty list turns the alerts off. It goes through JSON and not as an array parameter, so it is
 * the same on every driver. Returns false when the person has no such endpoint.
 */
export async function setEndpointEvents(
  db: SqlExecutor,
  userId: string,
  endpointId: string,
  eventTypes: readonly SubscribableEvent[],
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE webhook_endpoints
    SET event_types = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(eventTypes)}::jsonb)),
        updated_at = now()
    WHERE id = ${endpointId}::uuid AND user_id = ${userId}::uuid
    RETURNING id
  `);
  return rows.length > 0;
}

/** One row of the log of deliveries, as the page shows it. */
export type DeliveryView = {
  id: string;
  endpointId: string;
  /** What the event was (`webhook.test`). */
  type: string;
  attempt: number;
  statusCode: number | null;
  latencyMs: number | null;
  /** A short code, never a body or an address. */
  error: string | null;
  createdAt: Date;
};

/** The latest deliveries to the endpoints of the person, newest first. */
export async function listRecentDeliveries(
  db: SqlExecutor,
  userId: string,
  limit = 20,
): Promise<DeliveryView[]> {
  const { rows } = await db.execute(sql`
    SELECT d.id, d.endpoint_id, o.type, d.attempt, d.status_code, d.latency_ms,
           d.error, d.created_at
    FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.endpoint_id
    JOIN outbox o ON o.id = d.outbox_id
    WHERE e.user_id = ${userId}::uuid
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    endpointId: String(row.endpoint_id),
    type: String(row.type),
    attempt: Number(row.attempt),
    statusCode: row.status_code === null ? null : Number(row.status_code),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    error: row.error === null ? null : String(row.error),
    createdAt: asDate(row.created_at),
  }));
}

/**
 * The statement that queues an event for every enabled endpoint of a person that asked for its
 * type (SAG-27). It is a statement and not a call so a change can carry it in its own: written as a
 * data-modifying CTE next to the change, the event is queued if and only if the change is saved,
 * which is the transactional outbox (ADR-007). One row per endpoint, so an endpoint that is dead
 * holds back no other. The key of a row is the id of the event and the endpoint, so queuing the
 * same event twice queues it once.
 */
export function enqueueEventInsert(args: {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  /** Names the event, so a retry of the change that caused it does not queue it again. */
  eventId: string;
}): SQL {
  return sql`
    INSERT INTO outbox (type, payload, idempotency_key, endpoint_id)
    SELECT ${args.type}::text, ${JSON.stringify(args.payload)}::jsonb,
           ${args.eventId}::text || ':' || e.id::text, e.id
    FROM webhook_endpoints e
    WHERE e.user_id = ${args.userId}::uuid
      AND e.enabled
      AND ${args.type}::text = ANY (e.event_types)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
}

/** Queues an event on its own. A change that must be atomic with it embeds `enqueueEventInsert`. */
export async function enqueueEvent(
  db: SqlExecutor,
  args: Parameters<typeof enqueueEventInsert>[0],
): Promise<number> {
  const { rows } = await db.execute(enqueueEventInsert(args));
  return rows.length;
}

/**
 * Queues the test message for one endpoint of the person, which must be on. The test is sent right
 * away by the person's own request and is never retried, so its key is new every time. Returns the
 * id of the event, or null when the person has no such endpoint on.
 */
export async function queueTestEvent(
  db: SqlExecutor,
  userId: string,
  endpointId: string,
  locale: string,
): Promise<string | null> {
  const { rows } = await db.execute(sql`
    INSERT INTO outbox (type, payload, idempotency_key, endpoint_id)
    SELECT 'webhook.test', ${JSON.stringify({ locale })}::jsonb,
           ${`test:${crypto.randomUUID()}`}::text, e.id
    FROM webhook_endpoints e
    WHERE e.id = ${endpointId}::uuid AND e.user_id = ${userId}::uuid AND e.enabled
    RETURNING id
  `);
  return rows[0] ? String(rows[0].id) : null;
}

/** An event taken to be sent. It holds the address, so it must never be logged or sent to a page. */
export type ClaimedEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  /** The number of this try, 1 for the first. */
  attempt: number;
  endpointId: string;
  url: string;
};

const toClaimed = (row: Record<string, unknown>): ClaimedEvent => ({
  id: String(row.id),
  type: String(row.type),
  payload:
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {},
  attempt: Number(row.attempts),
  endpointId: String(row.endpoint_id),
  url: String(row.url),
});

/**
 * Takes up to `limit` events that are due, for endpoints that are on, and starts a try for each: it
 * adds one to `attempts` and moves `next_attempt_at` out by the lease. `FOR UPDATE SKIP LOCKED`
 * makes two runs at once take different events, and the lease means a run that dies leaves the rest
 * of its events to come back later, not to be sent twice at once. Only rows with an endpoint are
 * read: the other events in the table (`clerk.user_rejected`) are not deliveries.
 */
export async function claimDueEvents(
  db: SqlExecutor,
  limit: number,
  now: Date = new Date(),
): Promise<ClaimedEvent[]> {
  const { rows } = await db.execute(sql`
    WITH due AS (
      SELECT o.id
      FROM outbox o
      JOIN webhook_endpoints e ON e.id = o.endpoint_id AND e.enabled
      WHERE o.status = 'pending'
        AND o.endpoint_id IS NOT NULL
        AND o.next_attempt_at <= ${now.toISOString()}::timestamptz
      ORDER BY o.next_attempt_at, o.id
      LIMIT ${limit}
      FOR UPDATE OF o SKIP LOCKED
    ),
    claimed AS (
      UPDATE outbox
      SET attempts = attempts + 1,
          next_attempt_at = ${new Date(now.getTime() + leaseMs).toISOString()}::timestamptz,
          updated_at = now()
      WHERE id IN (SELECT id FROM due)
      RETURNING id, type, payload, attempts, endpoint_id
    )
    SELECT c.id, c.type, c.payload, c.attempts, c.endpoint_id, e.url
    FROM claimed c
    JOIN webhook_endpoints e ON e.id = c.endpoint_id
    ORDER BY c.id
  `);
  return rows.map(toClaimed);
}

/** Takes one event that was just queued, to be sent now (the test button). Null if it is not pending. */
export async function claimEvent(
  db: SqlExecutor,
  eventId: string,
  now: Date = new Date(),
): Promise<ClaimedEvent | null> {
  const { rows } = await db.execute(sql`
    WITH claimed AS (
      UPDATE outbox
      SET attempts = attempts + 1,
          next_attempt_at = ${new Date(now.getTime() + leaseMs).toISOString()}::timestamptz,
          updated_at = now()
      WHERE id = ${eventId}::uuid AND status = 'pending' AND endpoint_id IS NOT NULL
      RETURNING id, type, payload, attempts, endpoint_id
    )
    SELECT c.id, c.type, c.payload, c.attempts, c.endpoint_id, e.url
    FROM claimed c
    JOIN webhook_endpoints e ON e.id = c.endpoint_id
  `);
  return rows[0] ? toClaimed(rows[0]) : null;
}

/** Gives a claimed event back, to be tried at `resumeAt`, without using up the try. */
export async function releaseEvent(
  db: SqlExecutor,
  eventId: string,
  resumeAt: Date,
): Promise<void> {
  await db.execute(sql`
    UPDATE outbox
    SET attempts = greatest(attempts - 1, 0),
        next_attempt_at = ${resumeAt.toISOString()}::timestamptz,
        updated_at = now()
    WHERE id = ${eventId}::uuid AND status = 'pending'
  `);
}

export type RecordedTry = {
  event: Pick<ClaimedEvent, "id" | "endpointId" | "attempt">;
  statusCode: number | null;
  latencyMs: number | null;
  outcome: Outcome;
  now: Date;
};

/**
 * Records the result of one try, in one statement: the line of the log, the state of the event, and
 * the count of failures of the endpoint, which it turns off when the outcome says so or when the
 * count reaches `disableAfterFailures`. When the endpoint ends up off, this event and the others
 * waiting for it are given up on in the same statement, so none is left in the table to be read
 * again, or to be sent if the person turns the endpoint back on much later. Returns whether the
 * endpoint is still on afterwards.
 */
export async function recordTry(
  db: SqlExecutor,
  tried: RecordedTry,
): Promise<boolean> {
  const { event, outcome, now } = tried;
  const status =
    outcome.kind === "delivered"
      ? "delivered"
      : outcome.kind === "retry"
        ? "pending"
        : "failed";
  const nextAttemptAt =
    outcome.kind === "retry"
      ? new Date(now.getTime() + outcome.delayMs).toISOString()
      : null;
  const error = outcome.kind === "delivered" ? null : outcome.error;
  const reset = outcome.kind === "delivered";
  const countFailure = outcome.kind !== "delivered" && outcome.countFailure;
  const reason = outcome.kind === "failed" ? outcome.disable : null;

  // True when this try turns the endpoint off: a reason that says so, or one more failure that
  // brings the count to the limit. It reads the count the endpoint has now.
  const off = sql`(${reason}::text IS NOT NULL OR (${countFailure}::boolean AND failure_count + 1 >= ${disableAfterFailures}))`;

  const { rows } = await db.execute(sql`
    WITH log AS (
      INSERT INTO webhook_deliveries (endpoint_id, outbox_id, attempt, status_code, latency_ms, error)
      VALUES (${event.endpointId}::uuid, ${event.id}::uuid, ${event.attempt},
              ${tried.statusCode}::int, ${tried.latencyMs}::int, ${error}::text)
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    ep AS (
      UPDATE webhook_endpoints
      SET failure_count = CASE WHEN ${reset}::boolean THEN 0
                               WHEN ${countFailure}::boolean THEN failure_count + 1
                               ELSE failure_count END,
          disabled_at = CASE WHEN ${off} AND enabled THEN now() ELSE disabled_at END,
          disabled_reason = CASE WHEN ${off} AND enabled
                                 THEN coalesce(${reason}::text, 'too_many_failures')
                                 ELSE disabled_reason END,
          enabled = CASE WHEN ${off} THEN false ELSE enabled END,
          updated_at = now()
      WHERE id = ${event.endpointId}::uuid
      RETURNING enabled
    ),
    ev AS (
      UPDATE outbox
      SET status = CASE
            WHEN ${status}::text = 'pending' AND EXISTS (SELECT 1 FROM ep WHERE NOT enabled)
              THEN 'failed'::outbox_status
            ELSE ${status}::outbox_status
          END,
          next_attempt_at = coalesce(${nextAttemptAt}::timestamptz, next_attempt_at),
          last_error = ${error}::text,
          updated_at = now()
      WHERE id = ${event.id}::uuid
      RETURNING 1
    ),
    dropped AS (
      UPDATE outbox
      SET status = 'failed', last_error = 'endpoint_disabled', updated_at = now()
      WHERE endpoint_id = ${event.endpointId}::uuid
        AND status = 'pending'
        AND id <> ${event.id}::uuid
        AND EXISTS (SELECT 1 FROM ep WHERE NOT enabled)
      RETURNING 1
    )
    SELECT (SELECT enabled FROM ep) AS enabled
  `);
  return rows[0]?.enabled === true;
}

/**
 * Deletes what is older than `keepDays`: the log of deliveries, and the events that were delivered or
 * given up on (the pending ones stay, and so does any event that is not a delivery). Returns how many
 * events it deleted.
 */
export async function pruneDeliveries(
  db: SqlExecutor,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - keepDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { rows } = await db.execute(sql`
    WITH old_log AS (
      DELETE FROM webhook_deliveries WHERE created_at < ${cutoff}::timestamptz RETURNING 1
    ),
    old_events AS (
      DELETE FROM outbox
      WHERE endpoint_id IS NOT NULL AND status <> 'pending'
        AND updated_at < ${cutoff}::timestamptz
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM old_events)::int AS events
  `);
  return Number(rows[0]?.events ?? 0);
}
