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
};

/**
 * Asks every provider that covers the type, all at once. A provider that fails, times out or has
 * its circuit open is listed in `failures` and the others still answer: an outage degrades the
 * search, it does not break it.
 */
export async function searchAll(
  providers: readonly MediaProvider[],
  query: string,
  options: SearchOptions,
): Promise<SearchOutcome> {
  const covering = providers.filter(
    (provider) =>
      options.type === undefined ||
      provider.capabilities.types.includes(options.type),
  );
  const answers = await Promise.allSettled(
    covering.map((provider) => provider.search(query, options)),
  );

  const outcome: SearchOutcome = { results: [], failures: [] };
  answers.forEach((answer, index) => {
    const provider = covering[index].id;
    if (answer.status === "fulfilled") {
      for (const item of answer.value) outcome.results.push({ provider, item });
    } else {
      const error = answer.reason;
      // Only the kind of failure is kept: the text of an unknown error could carry anything.
      outcome.failures.push({
        provider,
        reason: error instanceof ProviderError ? error.kind : "error",
      });
    }
  });
  return outcome;
}
