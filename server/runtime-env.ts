import { env } from "cloudflare:workers";

import { parseEnv, type AppEnv } from "./env";

/** The only way app code reads environment variables. */
export function getEnv(): AppEnv {
  return parseEnv(env as unknown as Record<string, unknown>);
}
