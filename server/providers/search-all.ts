import { ProviderError } from "./http";
import type {
  MediaProvider,
  NormalizedMedia,
  ProviderId,
  SearchOptions,
} from "./types";

export type SearchOutcome = {
  results: { provider: ProviderId; item: NormalizedMedia }[];
  /** The providers that did not answer, and why. The page can say "some sources did not answer". */
  failures: { provider: ProviderId; reason: string }[];
  /** How long each provider took and whether it answered, for the latency metrics. */
  timings: { provider: ProviderId; ms: number; ok: boolean }[];
};

export type SearchAllOptions = {
  /** The whole search stops waiting here, whatever the providers are doing. */
  deadlineMs?: number;
  now?: () => number;
};

/** Rejects with a timeout when `signal` aborts, so a provider that ignores it cannot hold us. */
function whenAborted(provider: ProviderId, signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new ProviderError(provider, "timeout"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/**
 * Asks every provider that covers the type, all at once. A provider that fails, times out or has
 * its circuit open is listed in `failures` and the others still answer: an outage degrades the
 * search, it does not break it. At the deadline the search answers with what has arrived.
 */
export async function searchAll(
  providers: readonly MediaProvider[],
  query: string,
  options: SearchOptions,
  { deadlineMs = 3000, now = Date.now }: SearchAllOptions = {},
): Promise<SearchOutcome> {
  const covering = providers.filter(
    (provider) =>
      options.type === undefined ||
      provider.capabilities.types.includes(options.type),
  );
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;

  const outcome: SearchOutcome = { results: [], failures: [], timings: [] };
  await Promise.all(
    covering.map(async (provider) => {
      const started = now();
      try {
        const items = await Promise.race([
          provider.search(query, { ...options, signal }),
          whenAborted(provider.id, signal),
        ]);
        for (const item of items) {
          outcome.results.push({ provider: provider.id, item });
        }
        outcome.timings.push({
          provider: provider.id,
          ms: now() - started,
          ok: true,
        });
      } catch (error) {
        // Only the kind of failure is kept: the text of an unknown error could carry anything.
        outcome.failures.push({
          provider: provider.id,
          reason: error instanceof ProviderError ? error.kind : "error",
        });
        outcome.timings.push({
          provider: provider.id,
          ms: now() - started,
          ok: false,
        });
      }
    }),
  );
  return outcome;
}
