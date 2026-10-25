/**
 * Why a call to a provider did not give an answer. `circuit_open` and `rate_limited` mean the
 * call was not even sent. The message never carries a URL, a header or a response body, so a
 * key cannot end up in a log through it.
 */
export type ProviderErrorKind =
  "timeout" | "network" | "http" | "rate_limited" | "circuit_open";

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
  // Injectable so the tests need neither the network nor real time.
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type HttpClient = {
  getJson<T>(url: string, options?: { signal?: AbortSignal }): Promise<T>;
};

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
    retries = 2,
    ratePerSecond,
    burst = Math.max(1, Math.ceil(ratePerSecond)),
    maxWaitMs = 1000,
    failureThreshold = 5,
    openMs = 30_000,
    fetch: fetchImpl = fetch,
    now = Date.now,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let tokens = burst;
  let refilledAt = now();
  let failures = 0;
  let openUntil = 0;
  let probing = false;

  /** Takes a place in the bucket, or says how long to wait for one. */
  function takeToken(): number {
    const current = now();
    tokens = Math.min(
      burst,
      tokens + ((current - refilledAt) / 1000) * ratePerSecond,
    );
    refilledAt = current;
    if (tokens >= 1) {
      tokens -= 1;
      return 0;
    }
    return Math.ceil(((1 - tokens) / ratePerSecond) * 1000);
  }

  async function acquire(): Promise<void> {
    const wait = takeToken();
    if (wait === 0) return;
    if (wait > maxWaitMs) throw new ProviderError(provider, "rate_limited");
    await sleep(wait);
    // The place was reserved by waiting for it.
    tokens = Math.max(0, tokens - 1);
    refilledAt = now();
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

  async function attempt<T>(url: string, outer?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
    let response: Response;
    try {
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
    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderError(provider, "network");
    }
  }

  return {
    async getJson<T>(url: string, callOptions: { signal?: AbortSignal } = {}) {
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
          const result = await attempt<T>(url, callOptions.signal);
          recordSuccess();
          return result;
        } catch (error) {
          lastError =
            error instanceof ProviderError
              ? error
              : new ProviderError(provider, "network");
          if (callOptions.signal?.aborted || !isTransient(lastError)) break;
        }
      }
      const error = lastError ?? new ProviderError(provider, "network");
      // The caller cancelled: nothing is learned about the provider.
      if (callOptions.signal?.aborted) throw error;
      if (isTransient(error)) recordFailure();
      // An answer such as 404 means the provider is up. A call that was never sent says nothing.
      else if (error.kind === "http") recordSuccess();
      throw error;
    },
  };
}
