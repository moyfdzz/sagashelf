import { createHttpClient, ProviderError, type HttpClient } from "../http";
import { parseShow, type TvmazeShow } from "./map";

const baseUrl = "https://api.tvmaze.com";

// TVmaze allows at least 20 calls every 10 seconds per address and answers 429 above it (read
// 2026-10-31). Stay well under it: a Worker shares its address with others.
const requestsPerSecond = 2;

export type TvmazeClient = {
  /** The show with its next episode, or null when TVmaze does not know it (a 404). */
  getShow(
    id: number,
    options?: { signal?: AbortSignal },
  ): Promise<TvmazeShow | null>;
};

export function createTvmazeClient(http: HttpClient): TvmazeClient {
  return {
    async getShow(id, { signal } = {}) {
      // The id goes into the address, so it is checked to be a plain number first.
      if (!Number.isInteger(id) || id < 1 || id > 999_999_999) return null;
      try {
        return parseShow(
          await http.getJson<unknown>(
            `${baseUrl}/shows/${id}?embed=nextepisode`,
            { signal },
          ),
        );
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

let cached: TvmazeClient | null = null;

/** The client with its rate and the statuses that must stop it. No key is needed. */
export function createTvmazeClientWithDefaults(
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
): TvmazeClient {
  return createTvmazeClient(
    createHttpClient({
      provider: "tvmaze",
      ratePerSecond: requestsPerSecond,
      timeoutMs: 8000,
      // A 5xx may be a blip; a 429 is never insisted on: the circuit opens and the run stops.
      retries: 1,
      stopOnStatus: [429],
      stopMs: 60_000,
      ...overrides,
    }),
  );
}

/** One client per Worker instance, so its circuit breaker keeps its state between runs. */
export function getTvmazeClient(): TvmazeClient {
  cached ??= createTvmazeClientWithDefaults();
  return cached;
}
