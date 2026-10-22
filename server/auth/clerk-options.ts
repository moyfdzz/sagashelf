import type { AppEnv } from "../env";

export type ClerkKeys = {
  publishableKey: string;
  secretKey: string;
  jwtKey?: string;
};

/**
 * The PEM public key sits on one line in `.dev.vars` and in dashboards, with `\n` for line
 * breaks. Turns those into real line breaks, and leaves a key that already has them alone.
 */
export function normalizeJwtKey(raw: string): string {
  return raw.replace(/\n/g, "\n").trim();
}

/**
 * The keys Clerk needs, or null when the app has no Clerk configuration (previews and tests
 * without keys). With a `jwtKey` the Worker checks session tokens without calling Clerk.
 */
export function clerkKeysFromEnv(env: AppEnv): ClerkKeys | null {
  const { CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, CLERK_JWT_KEY } = env;
  if (!CLERK_PUBLISHABLE_KEY || !CLERK_SECRET_KEY) return null;

  return {
    publishableKey: CLERK_PUBLISHABLE_KEY,
    secretKey: CLERK_SECRET_KEY,
    jwtKey: CLERK_JWT_KEY ? normalizeJwtKey(CLERK_JWT_KEY) : undefined,
  };
}
