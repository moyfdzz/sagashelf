import type { AttemptResult } from "./outcome";
import { maxRetryAfterMs } from "./outcome";
import type { DiscordMessage } from "./message";
import { providerUserAgent } from "../providers/http";

/** How long one call may take. A webhook answers in well under a second when it is healthy. */
export const sendTimeoutMs = 5_000;

export type SendResult = AttemptResult & {
  /** How long the call took, for the log. */
  latencyMs: number;
  /** What Discord says is left of this webhook's limit, when it says it. */
  remaining: number | null;
  /** When that limit resets, in milliseconds from now, when Discord says it. */
  resetAfterMs: number | null;
};

type SendDeps = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

const seconds = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const toMs = (value: number | null) =>
  value === null ? null : Math.min(Math.round(value * 1000), maxRetryAfterMs);

/**
 * Posts a message to a Discord webhook (SAG-27, ADR-029). `url` must have been checked by
 * `parseDiscordWebhookUrl`: this function trusts it. It never follows a redirect (`manual`: a 3xx is
 * given back as it is and counted as a failure, so an address cannot lead the Worker somewhere
 * else), it gives up after the timeout, and it reads nothing of the answer except, for a 429, the
 * time Discord asks to wait. Nothing it returns holds the address or the body of an answer.
 */
export async function sendDiscord(
  url: string,
  message: DiscordMessage,
  deps: SendDeps = {},
): Promise<SendResult> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const latency = () => Math.max(0, now() - startedAt);
  const none = { remaining: null, resetAfterMs: null, retryAfterMs: null };

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": providerUserAgent,
      },
      body: JSON.stringify(message),
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? sendTimeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ...none,
      status: null,
      error: timedOut ? "timeout" : "network",
      latencyMs: latency(),
    };
  }

  const remaining = seconds(response.headers.get("X-RateLimit-Remaining"));
  const resetAfterMs = toMs(
    seconds(response.headers.get("X-RateLimit-Reset-After")),
  );

  let retryAfterMs: number | null = null;
  if (response.status === 429) {
    // `retry_after` in the body is in seconds ("The number of seconds to wait", Discord's rate
    // limits page, read 2026-11-02); the header is read as seconds too, which that page implies
    // with an example but does not say. The reset time is the last resort.
    let bodySeconds: number | null = null;
    try {
      const body = (await response.json()) as { retry_after?: unknown };
      bodySeconds =
        typeof body.retry_after === "number" && body.retry_after >= 0
          ? body.retry_after
          : null;
    } catch {
      // A body that is not JSON says nothing; the header may.
    }
    retryAfterMs =
      toMs(bodySeconds) ??
      toMs(seconds(response.headers.get("Retry-After"))) ??
      resetAfterMs;
  } else {
    // The answer is not read; letting go of it frees the connection.
    await response.body?.cancel().catch(() => undefined);
  }

  return {
    status: response.status,
    error: null,
    retryAfterMs,
    remaining,
    resetAfterMs,
    latencyMs: latency(),
  };
}
