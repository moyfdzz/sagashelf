import type { SqlExecutor } from "../db/clerk-sync";
import { claimEvent, queueTestEvent } from "../db/webhooks";
import { deliverEvent } from "./deliver-outbox";

export type TestMessageResult =
  | { found: false }
  | {
      found: true;
      delivered: boolean;
      /** The status Discord answered, or null when nothing came back. */
      status: number | null;
      /** A short code, never a body or an address; null when it was delivered. */
      reason: string | null;
      /** False when this try turned the endpoint off. */
      endpointOn: boolean;
    };

/**
 * The "Test" button of a webhook (SAG-105, ADR-029): queues a test message for one endpoint of the
 * person, takes it at once and sends it now, with the same rules as the job that delivers the rest.
 * It is sent by the person's own request and never retried, since a message that arrives hours later
 * is not a test. `found` is false when the person has no such endpoint on, or the event cannot be
 * taken, and then nothing is sent.
 *
 * What it answers is only what the page shows: whether it arrived, the status, a short reason and
 * whether the endpoint is still on. The claimed event holds the whole address, so it never leaves
 * this function.
 */
export async function sendTestMessage(
  db: SqlExecutor,
  userId: string,
  endpointId: string,
  locale: "es" | "en",
): Promise<TestMessageResult> {
  const eventId = await queueTestEvent(db, userId, endpointId, locale);
  if (!eventId) return { found: false };
  const event = await claimEvent(db, eventId);
  if (!event) return { found: false };
  const result = await deliverEvent({ db }, event);
  return {
    found: true,
    delivered: result.outcome.kind === "delivered",
    status: result.statusCode,
    reason: result.outcome.kind === "delivered" ? null : result.outcome.error,
    endpointOn: result.endpointOn,
  };
}
