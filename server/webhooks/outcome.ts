/**
 * What to do after one try to deliver an event (SAG-27, ADR-029): a pure decision from what came
 * back, so every rule can be tested without a network or a database.
 */

/** The wait before each retry, as the ticket asks: 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours. */
export const retryDelaysMs = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  12 * 3_600_000,
] as const;

/** The first try plus one per wait. After the last one the event is given up on. */
export const maxAttempts = retryDelaysMs.length + 1;

/**
 * A pending event older than this is given up on, not sent: a message about an episode of days ago
 * is no longer news. It is the announce window of the episode alerts (3 days, SAG-184).
 */
export const maxPendingAgeMs = 3 * 24 * 3_600_000;

/** Failures in a row, over any events, after which the endpoint is turned off. */
export const disableAfterFailures = 5;

/** A `retry_after` longer than this is cut: nobody should be told to wait days. */
export const maxRetryAfterMs = 12 * 3_600_000;

/** At least this long: a retry the moment Discord says "wait" would only be refused again. */
const minRetryAfterMs = 1_000;

/**
 * The wait before the try after `attempt` (1 is the first one), spread by up to 20% either way so
 * many events that failed together do not all come back together. Null when there is no try left.
 */
export function backoffMs(
  attempt: number,
  random: () => number = Math.random,
): number | null {
  const base = retryDelaysMs[attempt - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Why an endpoint was turned off. Each one has its text in app/locales, under the notifications page. */
export type DisableReason = "unauthorized" | "not_found" | "too_many_failures";

/** What one try gave back. The body and the address never go in here: only what the decision needs. */
export type AttemptResult = {
  /** The HTTP status, or null when there was no answer. */
  status: number | null;
  /** Why there was no answer. */
  error: "timeout" | "network" | null;
  /** How long Discord asked to wait, in milliseconds, when it said so. */
  retryAfterMs: number | null;
};

export type Outcome =
  | { kind: "delivered" }
  | {
      kind: "retry";
      delayMs: number;
      /** Counts toward turning the endpoint off. A rate limit is not the endpoint's fault. */
      countFailure: boolean;
      error: string;
    }
  | {
      kind: "failed";
      countFailure: boolean;
      /** Turn the endpoint off now, whatever its count. */
      disable: DisableReason | null;
      error: string;
    };

/** A short code for the log and the page: never a body, an address or a message of the other side. */
function errorCode(result: AttemptResult): string {
  if (result.error) return result.error;
  if (result.status !== null && result.status >= 300 && result.status < 400) {
    return "redirect";
  }
  return `http_${result.status ?? "none"}`;
}

/**
 * - 2xx: delivered.
 * - 429: wait what Discord said and try again; it does not count against the endpoint.
 * - 401, 403: the token is no good; 404, 410: the webhook is gone. Discord restricts a caller that
 *   keeps using a webhook that answers 404, so the endpoint is turned off at once.
 * - Any other 4xx: our message was refused and the same one would be again, so it is not retried.
 * - A redirect: never followed (that would let an address lead somewhere else) and not retried.
 * - 5xx, no answer, a timeout: retry with the waits above, until they run out.
 */
export function decide(
  result: AttemptResult,
  attempt: number,
  random: () => number = Math.random,
): Outcome {
  const { status } = result;
  const error = errorCode(result);

  if (status !== null && status >= 200 && status < 300) {
    return { kind: "delivered" };
  }

  if (status === 429) {
    if (attempt >= maxAttempts) {
      return { kind: "failed", countFailure: false, disable: null, error };
    }
    const asked = result.retryAfterMs ?? backoffMs(attempt, random) ?? 0;
    const delayMs = Math.min(Math.max(asked, minRetryAfterMs), maxRetryAfterMs);
    return { kind: "retry", delayMs, countFailure: false, error };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "failed",
      countFailure: false,
      disable: "unauthorized",
      error,
    };
  }
  if (status === 404 || status === 410) {
    return {
      kind: "failed",
      countFailure: false,
      disable: "not_found",
      error,
    };
  }
  if (status !== null && status >= 300 && status < 500) {
    return { kind: "failed", countFailure: true, disable: null, error };
  }

  const delayMs = backoffMs(attempt, random);
  if (delayMs === null) {
    return { kind: "failed", countFailure: true, disable: null, error };
  }
  return { kind: "retry", delayMs, countFailure: true, error };
}
