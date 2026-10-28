import { createMangadexProviderWithDefaults } from "./mangadex";
import { createOpenLibraryProviderWithDefaults } from "./open-library";
import { createTmdbProviderWithToken } from "./tmdb";
import type { MediaProvider } from "./types";

// Each Worker instance builds its providers once, so the rate limiter and the circuit breaker
// keep their state between requests served by the same instance.
let cachedTmdb: { token: string; provider: MediaProvider } | null = null;
let cachedOpenLibrary: MediaProvider | null = null;
let cachedMangadex: MediaProvider | null = null;

/**
 * The providers this deployment can use. TMDB needs its secret, so a preview with no token has
 * none of it. Open Library and MangaDex need no key, so each is switched on by its own variable
 * (`OPEN_LIBRARY_ENABLED`, `MANGADEX_ENABLED`): a test run or a preview that does not set them
 * never calls out to the real services. With no provider the search answers from the database
 * alone.
 */
export function buildProviders(options: {
  tmdbReadAccessToken?: string;
  openLibraryEnabled?: boolean;
  mangadexEnabled?: boolean;
}): MediaProvider[] {
  const providers: MediaProvider[] = [];

  const token = options.tmdbReadAccessToken;
  if (token) {
    if (cachedTmdb?.token !== token) {
      cachedTmdb = { token, provider: createTmdbProviderWithToken(token) };
    }
    providers.push(cachedTmdb.provider);
  }

  if (options.openLibraryEnabled) {
    cachedOpenLibrary ??= createOpenLibraryProviderWithDefaults();
    providers.push(cachedOpenLibrary);
  }

  if (options.mangadexEnabled) {
    cachedMangadex ??= createMangadexProviderWithDefaults();
    providers.push(cachedMangadex);
  }

  return providers;
}
