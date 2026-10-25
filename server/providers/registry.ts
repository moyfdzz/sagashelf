import { createTmdbProviderWithToken } from "./tmdb";
import type { MediaProvider } from "./types";

// Each Worker instance builds its providers once, so the rate limiter and the circuit breaker
// keep their state between requests served by the same instance.
let cached: { token: string; providers: MediaProvider[] } | null = null;

/**
 * The providers this deployment can use: only those whose secret is set. A preview with no TMDB
 * token has no providers, and the search then answers from the database alone.
 */
export function buildProviders(secrets: {
  tmdbReadAccessToken?: string;
}): MediaProvider[] {
  const token = secrets.tmdbReadAccessToken;
  if (!token) return [];
  if (cached?.token !== token) {
    cached = { token, providers: [createTmdbProviderWithToken(token)] };
  }
  return cached.providers;
}
