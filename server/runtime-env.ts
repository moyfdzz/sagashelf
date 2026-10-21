import { env } from "cloudflare:workers";

import { parseEnv, type AppEnv } from "./env";

/** The Workers Rate Limiting binding for write endpoints (see `ratelimits` in wrangler.jsonc). */
export function getWriteLimiter() {
  // Previews do not inherit bindings; a missing one must be loud in the logs.
  if (!env.WRITE_LIMITER) {
    throw new Error("The WRITE_LIMITER binding is missing in wrangler.jsonc");
  }
  return env.WRITE_LIMITER;
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
