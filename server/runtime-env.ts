import { env, waitUntil } from "cloudflare:workers";

import {
  clerkKeysFromEnv,
  webhookSecretFromEnv,
  type ClerkKeys,
} from "./auth/clerk-options";
import { parseEnv, type AppEnv } from "./env";
import { buildProviders } from "./providers/registry";
import { createSearchCache } from "./search/cache";

/** The Workers Rate Limiting binding for write endpoints (see `ratelimits` in wrangler.jsonc). */
export function getWriteLimiter() {
  // Previews do not inherit bindings; a missing one must be loud in the logs.
  if (!env.WRITE_LIMITER) {
    throw new Error("The WRITE_LIMITER binding is missing in wrangler.jsonc");
  }
  return env.WRITE_LIMITER;
}

/** The Workers Rate Limiting binding for the search (see `ratelimits` in wrangler.jsonc). */
export function getSearchLimiter() {
  if (!env.SEARCH_LIMITER) {
    throw new Error("The SEARCH_LIMITER binding is missing in wrangler.jsonc");
  }
  return env.SEARCH_LIMITER;
}

/** The Workers Rate Limiting binding for the image proxy (see `ratelimits` in wrangler.jsonc). */
export function getImageLimiter() {
  if (!env.IMAGE_LIMITER) {
    throw new Error("The IMAGE_LIMITER binding is missing in wrangler.jsonc");
  }
  return env.IMAGE_LIMITER;
}

/** The Workers Cache API, or null when the runtime has none (it may not run on every host). */
function defaultCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  return (caches as unknown as { default?: Cache }).default ?? null;
}

/** Where the image proxy keeps the images it served, for a day. */
export function getImageCache() {
  return defaultCache();
}

/**
 * The search cache on the Workers Cache API, or one that keeps nothing when the runtime has no
 * `caches` (the Cache API may not run on every host, so the search must work without it).
 */
export function getSearchCache() {
  return createSearchCache(defaultCache());
}

/** Lets the Worker finish this work after the response has been sent. */
export function runInBackground(work: Promise<unknown>): void {
  waitUntil(work);
}

/** The only way app code reads environment variables. */
export function getEnv(): AppEnv {
  return parseEnv(env as unknown as Record<string, unknown>);
}

/**
 * The database for this request. Fails by name, never by value, when the secret is not set.
 * The client loads on first use, so pages that do not read data do not pay for it at startup.
 */
export async function getDb() {
  const { DATABASE_URL } = getEnv();
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set: add it as a Workers secret (or in .dev.vars for local development)",
    );
  }
  const { createDb } = await import("./db/client");
  return createDb(DATABASE_URL);
}

/** The Clerk keys, or null when this deployment has none. Reads only the Clerk variables. */
export function getClerkKeys(): ClerkKeys | null {
  return clerkKeysFromEnv(env as unknown as Record<string, unknown>);
}

/** The data providers this deployment can use: TMDB with its secret, Open Library when enabled. */
export function getMediaProviders() {
  const { TMDB_READ_ACCESS_TOKEN, OPEN_LIBRARY_ENABLED } = getEnv();
  return buildProviders({
    tmdbReadAccessToken: TMDB_READ_ACCESS_TOKEN,
    openLibraryEnabled: OPEN_LIBRARY_ENABLED === "true",
  });
}

/** The Clerk webhook signing secret, or null when this deployment has none. */
export function getClerkWebhookSecret(): string | null {
  return webhookSecretFromEnv(env as unknown as Record<string, unknown>);
}
