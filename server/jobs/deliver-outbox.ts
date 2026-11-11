import type { SqlExecutor } from "../db/clerk-sync";
import {
  claimDueEvents,
  pruneDeliveries,
  recordTry,
  releaseEvent,
  type ClaimedEvent,
} from "../db/webhooks";
import { sendDiscord, type SendResult } from "../webhooks/discord";
import { parseDiscordWebhookUrl } from "../webhooks/discord-url";
import { discordMessage } from "../webhooks/message";
import { decide, type Outcome } from "../webhooks/outcome";

/**
 * Events delivered in one run (SAG-27, ADR-029). A scheduled invocation shares 50 subrequests, and
 * this job has an invocation of its own (its own Cron Trigger): the claim is 1, each event is 2 (one
 * call to Discord and one statement that records it) and the clean-up is 1, so 20 events are 42 at
 * most. An event that is held back for a rate limit costs 1, not 2.
 */
export const eventsPerRun = 20;

export type DeliveryDeps = {
  db: SqlExecutor;
  /** Injected in tests; the global `fetch` otherwise. */
  fetch?: typeof fetch;
  now?: () => Date;
  random?: () => number;
  /** What an event says in Discord. Injected in tests; `discordMessage` otherwise. */
  messageFor?: typeof discordMessage;
};

export type DeliverySummary = {
  found: number;
  delivered: number;
  retried: number;
  failed: number;
  /** Held back because Discord said the limit of that webhook was used up. */
  paused: number;
  /** Endpoints this run turned off. */
  disabled: number;
  /** Events the run had taken for an endpoint that it turned off first: given up on, not sent. */
  skipped: number;
  /** Events whose result could not be recorded; they come back after their lease. */
  errors: number;
  /** The names of the errors that were caught and how many of each, never a message or a value. */
  errorNames: Record<string, number>;
};

export type DeliveryResult = {
  outcome: Outcome;
  statusCode: number | null;
  latencyMs: number | null;
  /** False when this try turned the endpoint off. */
  endpointOn: boolean;
  /** When the next event for this endpoint may go, if Discord said its limit was used up. */
  resumeAt: Date | null;
};

const noSend = {
  status: null,
  error: null,
  retryAfterMs: null,
  latencyMs: 0,
  remaining: null,
  resetAfterMs: null,
} satisfies SendResult;

/**
 * Sends one claimed event and records what happened. It is what the Cron Trigger runs for each
 * event, and what the "Test" button runs for its own: the same rules for both. A test is never
 * retried, since a message that arrives hours later is not a test.
 *
 * The address is checked again here, whatever the table holds: this is the last step before the
 * request leaves, so it is the one that must not trust the data. A row that fails the check, or an
 * event of a kind that has no message, is given up on without sending anything.
 */
export async function deliverEvent(
  deps: DeliveryDeps,
  event: ClaimedEvent,
): Promise<DeliveryResult> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  const message = (deps.messageFor ?? discordMessage)(
    event.type,
    event.payload,
  );
  const address = parseDiscordWebhookUrl(event.url);

  let send: SendResult = noSend;
  let outcome: Outcome;
  if (!message) {
    outcome = {
      kind: "failed",
      countFailure: false,
      disable: null,
      error: "unknown_event",
    };
  } else if (!address) {
    outcome = {
      kind: "failed",
      countFailure: true,
      disable: null,
      error: "invalid_url",
    };
  } else {
    send = await sendDiscord(address.url, message, {
      fetch: deps.fetch,
      now: () => now().getTime(),
    });
    outcome = decide(send, event.attempt, random);
    if (event.type === "webhook.test" && outcome.kind === "retry") {
      outcome = {
        kind: "failed",
        countFailure: outcome.countFailure,
        disable: null,
        error: outcome.error,
      };
    }
  }

  const endpointOn = await recordTry(deps.db, {
    event,
    statusCode: send.status,
    latencyMs: message && address ? send.latencyMs : null,
    outcome,
    now: now(),
  });

  const limitUsedUp =
    outcome.kind === "delivered" &&
    send.remaining === 0 &&
    send.resetAfterMs !== null;
  return {
    outcome,
    statusCode: send.status,
    latencyMs: message && address ? send.latencyMs : null,
    endpointOn,
    resumeAt: limitUsedUp
      ? new Date(now().getTime() + (send.resetAfterMs ?? 0))
      : null,
  };
}

/**
 * Delivers the events that are due: takes up to `limit`, sends each one, and records every result on
 * its own, so one that fails changes nothing for the rest. An endpoint that is dead is turned off by
 * its own failures and holds back no other endpoint; one that is rate limited is left alone until its
 * limit resets. An event whose result cannot be recorded is counted and left to come back when its
 * lease ends. A failure in one event never stops the run.
 */
export async function deliverDueEvents(
  deps: DeliveryDeps,
  limit: number = eventsPerRun,
): Promise<DeliverySummary> {
  const now = deps.now ?? (() => new Date());
  const summary: DeliverySummary = {
    found: 0,
    delivered: 0,
    retried: 0,
    failed: 0,
    paused: 0,
    disabled: 0,
    skipped: 0,
    errors: 0,
    errorNames: {},
  };
  const countError = (error: unknown) => {
    summary.errors += 1;
    const name = error instanceof Error ? error.name : "unknown";
    summary.errorNames[name] = (summary.errorNames[name] ?? 0) + 1;
  };

  const events = await claimDueEvents(deps.db, limit, now());
  summary.found = events.length;

  const pausedUntil = new Map<string, Date>();
  const turnedOff = new Set<string>();
  for (const event of events) {
    // The statement that turned the endpoint off gave up on its other events, so this one is
    // already failed in the table: sending it now would post to an endpoint that is off.
    if (turnedOff.has(event.endpointId)) {
      summary.skipped += 1;
      continue;
    }
    const resumeAt = pausedUntil.get(event.endpointId);
    if (resumeAt) {
      try {
        await releaseEvent(deps.db, event.id, resumeAt);
        summary.paused += 1;
      } catch (error) {
        countError(error);
      }
      continue;
    }
    try {
      const result = await deliverEvent(deps, event);
      if (result.outcome.kind === "delivered") summary.delivered += 1;
      // A retry that turned its endpoint off is given up on too, so it is counted as failed.
      else if (result.outcome.kind === "retry" && result.endpointOn) {
        summary.retried += 1;
      } else summary.failed += 1;
      if (!result.endpointOn) {
        summary.disabled += 1;
        turnedOff.add(event.endpointId);
      }
      if (result.resumeAt) pausedUntil.set(event.endpointId, result.resumeAt);
    } catch (error) {
      countError(error);
    }
  }

  // The log grows only when events are sent, so that is when it is trimmed.
  if (events.length > 0) {
    try {
      await pruneDeliveries(deps.db, now());
    } catch (error) {
      countError(error);
    }
  }
  return summary;
}
