import type { z } from "zod";

import type { ProviderOutcome } from "../db/schema/providers";
import { readBoundedBody } from "./bounded-body";
import { recordProviderCall, type ProviderCall } from "./call-log";

/**
 * Why a call to a provider did not give an answer. `circuit_open` and `rate_limited` mean the
 * call was not even sent. The message never carries a URL, a header or a response body, so a
 * key cannot end up in a log through it.
 */
export type ProviderErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "rate_limited"
  | "circuit_open"
  // The answer came, but it is too big or not the shape that is read (SAG-185).
  | "invalid";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(`${provider}: ${kind}${status ? ` ${status}` : ""}`);
    this.name = "ProviderError";
  }
}

/** The `User-Agent` every provider is asked to receive: the app and a way to reach its owner. */
export const providerUserAgent =
  "SagaShelf/1.0 (+https://sagashelf.app; contact@sagashelf.app)";

export type HttpClientOptions = {
  /** Used in errors and logs, for example `tmdb`. */
  provider: string;
  /** Sent with every request. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** The most bytes of an answer that are read; a bigger one is refused (SAG-185). */
  maxBodyBytes?: number;
  /** Extra tries after the first one, for a GET only. */
  retries?: number;
  /** Requests per second, with a burst up to `burst`. */
  ratePerSecond: number;
  burst?: number;
  /** The longest the client waits for a free place before giving up. */
  maxWaitMs?: number;
  /** Failures in a row that open the circuit, and how long it stays open. */
  failureThreshold?: number;
  openMs?: number;
  /**
   * Statuses that open the circuit at once and are never retried, for a provider that bans an
   * address that keeps asking after a 429 or a 403 (MangaDex). The circuit stays open for
   * `stopMs`, then one call tests it.
   */
  stopOnStatus?: readonly number[];
  stopMs?: number;
  // Injectable so the tests need neither the network nor real time.
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /**
   * Told how each call ended (SAG-26, ADR-052). It defaults to the count that the administration
   * reads; a test can pass its own. It must never throw, and if it does the call is not affected.
   */
  onCall?: (call: ProviderCall) => void;
};

export type HttpClient = {
  getJson<T>(
    url: string,
    options?: {
      signal?: AbortSignal;
      /** Checks the answer has the fields that are read; a wrong one is a `ProviderError`. */
      schema?: z.ZodType<T>;
    },
  ): Promise<T>;
};

/** No JSON answer of a provider is this big; a bigger one is refused, not read (SAG-185). */
export const defaultMaxBodyBytes = 5_000_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A failure that says the provider is struggling (it is worth a retry, and it counts toward
 * opening the circuit), as opposed to a request that was wrong, such as a 404 or a 401.
 */
function isTransient(error: ProviderError): boolean {
  if (error.kind === "timeout" || error.kind === "network") return true;
  return (
    error.kind === "http" &&
    (error.status === 429 || (error.status ?? 0) >= 500)
  );
}

/**
 * How a failed call is counted: the status class for an answer that was not good, and the kind of
 * the error for the rest. A failure that is not a `ProviderError` was a broken connection.
 */
export function outcomeOf(error: unknown): ProviderOutcome {
  if (!(error instanceof ProviderError)) return "network";
  if (error.kind !== "http") return error.kind;
  const status = error.status ?? 0;
  if (status === 429) return "http_429";
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500) return "http_5xx";
  return "http_other";
}

let outgoingCalls = 0;

/**
 * How many requests every provider client of this isolate has sent, retries included. A scheduled
 * run has 50 subrequests (ADR-001) and each retry spends one, so a job that must stay inside the
 * budget reads this before and after its calls (SAG-182).
 */
export const countOutgoingCalls = (): number => outgoingCalls;

/**
 * A small HTTP client for one provider. It gives every call a timeout, retries a failed GET a
 * couple of times with a random pause, keeps to the provider's rate with a token bucket, and
 * stops calling a provider that keeps failing (a circuit breaker) so a slow provider does not
 * hold up the others. The state lives in this isolate: Workers do not share memory, so each
 * instance keeps its own count. That slows a provider down; it is not an exact quota.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    provider,
    headers = {},
    timeoutMs = 2500,
    maxBodyBytes = defaultMaxBodyBytes,
    retries = 2,
    ratePerSecond,
    burst = Math.max(1, Math.ceil(ratePerSecond)),
    maxWaitMs = 1000,
    failureThreshold = 5,
    openMs = 30_000,
    stopOnStatus = [],
    stopMs = 60_000,
    fetch: fetchImpl = fetch,
    now = Date.now,
    sleep = defaultSleep,
    random = Math.random,
    onCall = recordProviderCall,
  } = options;

  let tokens = burst;
  let refilledAt = now();
  let failures = 0;
  let openUntil = 0;
  let probing = false;

  /**
   * Reserves the next place in the bucket and says how long to wait for it.
   * The place is taken even when it is not free yet (the count goes below
   * zero), so calls that arrive together queue one after another.
   */
  function reservePlace(): number {
    const current = now();
    tokens = Math.min(
      burst,
      tokens + ((current - refilledAt) / 1000) * ratePerSecond,
    );
    refilledAt = current;
    tokens -= 1;
    if (tokens >= 0) return 0;
    return Math.ceil((-tokens / ratePerSecond) * 1000);
  }

  async function acquire(): Promise<void> {
    const wait = reservePlace();
    if (wait === 0) return;
    if (wait > maxWaitMs) {
      // A call that never leaves gives its place back.
      tokens += 1;
      throw new ProviderError(provider, "rate_limited");
    }
    await sleep(wait);
  }

  function checkCircuit(): void {
    if (failures < failureThreshold) return;
    if (now() < openUntil) throw new ProviderError(provider, "circuit_open");
    // Half open: one call goes through to see whether the provider is back.
    if (probing) throw new ProviderError(provider, "circuit_open");
    probing = true;
  }

  function recordSuccess(): void {
    failures = 0;
    probing = false;
  }

  function recordFailure(): void {
    probing = false;
    failures += 1;
    if (failures >= failureThreshold) openUntil = now() + openMs;
  }

  async function attempt<T>(
    url: string,
    outer?: AbortSignal,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
    let response: Response;
    try {
      outgoingCalls += 1;
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": providerUserAgent,
          ...headers,
        },
        signal,
      });
    } catch {
      // The caller cancelled: not the provider's fault and not worth a retry.
      if (outer?.aborted) throw new ProviderError(provider, "network");
      throw new ProviderError(
        provider,
        timeout.aborted ? "timeout" : "network",
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(provider, "http", response.status);
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readBoundedBody(response, maxBodyBytes);
    } catch {
      throw new ProviderError(provider, "network");
    }
    if (!bytes) throw new ProviderError(provider, "invalid");
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ProviderError(provider, "network");
    }
    if (!schema) return body as T;
    const checked = schema.safeParse(body);
    if (!checked.success) throw new ProviderError(provider, "invalid");
    return checked.data;
  }

  async function getWithRetries<T>(
    url: string,
    callOptions: { signal?: AbortSignal; schema?: z.ZodType<T> },
    counter: { sent: number },
  ): Promise<T> {
    checkCircuit();
    let lastError: ProviderError | undefined;
    for (let tryNumber = 0; tryNumber <= retries; tryNumber += 1) {
      if (tryNumber > 0) {
        // 200 ms, 400 ms, ... each between half and the full value, so clients do not retry
        // in step.
        const base = 200 * 2 ** (tryNumber - 1);
        await sleep(base * (0.5 + random() / 2));
      }
      try {
        await acquire();
        counter.sent += 1;
        const result = await attempt<T>(
          url,
          callOptions.signal,
          callOptions.schema,
        );
        recordSuccess();
        return result;
      } catch (error) {
        lastError =
          error instanceof ProviderError
            ? error
            : new ProviderError(provider, "network");
        if (callOptions.signal?.aborted) break;
        if (
          lastError.kind === "http" &&
          stopOnStatus.includes(lastError.status ?? 0)
        ) {
          // Asking again could get the address banned: open the circuit and say no more.
          failures = failureThreshold;
          openUntil = now() + stopMs;
          probing = false;
          throw lastError;
        }
        if (!isTransient(lastError)) break;
      }
    }
    const error = lastError ?? new ProviderError(provider, "network");
    // The caller cancelled: nothing is learned about the provider.
    if (callOptions.signal?.aborted) throw error;
    if (isTransient(error)) recordFailure();
    // An answer such as 404 means the provider is up, and so does one that is too big or not the
    // shape that is read: it answered. This also frees the call that tests a provider (SAG-185).
    else if (error.kind === "http" || error.kind === "invalid") recordSuccess();
    // A call that was never sent says nothing, but it must not keep the testing call taken.
    else probing = false;
    throw error;
  }

  return {
    async getJson<T>(
      url: string,
      callOptions: { signal?: AbortSignal; schema?: z.ZodType<T> } = {},
    ) {
      const startedAt = now();
      const counter = { sent: 0 };
      // Counting never changes what the call does: a count that fails is lost, nothing more.
      const count = (outcome: ProviderOutcome) => {
        try {
          onCall({
            provider,
            outcome,
            requests: counter.sent,
            ms: now() - startedAt,
          });
        } catch {
          // Nothing to do.
        }
      };
      try {
        const result = await getWithRetries<T>(url, callOptions, counter);
        count("ok");
        return result;
      } catch (error) {
        // The caller cancelled: nothing is learned about the provider.
        if (!callOptions.signal?.aborted) count(outcomeOf(error));
        throw error;
      }
    },
  };
}
