import { env } from "cloudflare:workers";

import { parseEnv, type AppEnv } from "./env";

/** The Workers Rate Limiting binding for write endpoints (see `ratelimits` in wrangler.jsonc). */
export function getWriteLimiter() {
  return env.WRITE_LIMITER;
}

/** The only way app code reads environment variables. */
export function getEnv(): AppEnv {
  return parseEnv(env as unknown as Record<string, unknown>);
}
