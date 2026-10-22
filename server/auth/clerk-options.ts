import { z } from "zod";

export type ClerkKeys = {
  publishableKey: string;
  secretKey: string;
  jwtKey?: string;
};

// Only the Clerk variables are read here, so a problem with an unrelated one (APP_ENV,
// DATABASE_URL) cannot take every page down. An empty value counts as not set, which is what
// a copy of `.env.example` leaves behind.
const clerkEnvSchema = z.object({
  CLERK_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_/)
    .optional(),
  CLERK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_/)
    .optional(),
  CLERK_JWT_KEY: z.string().optional(),
});

/**
 * The signing secret of the Clerk webhook, or null when this deployment has none. An empty
 * value counts as not set. A value in the wrong shape throws an error that names the
 * variable and never its value.
 */
export function webhookSecretFromEnv(
  raw: Record<string, unknown>,
): string | null {
  const value = raw["CLERK_WEBHOOK_SIGNING_SECRET"];
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !value.startsWith("whsec_")) {
    throw new Error(
      "Invalid Clerk environment variables: CLERK_WEBHOOK_SIGNING_SECRET",
    );
  }
  return value;
}

/**
 * The PEM public key sits on one line in `.dev.vars` and in dashboards, with `\n` for line
 * breaks. Turns those into real line breaks, and leaves a key that already has them alone.
 */
export function normalizeJwtKey(raw: string): string {
  // A value pasted into a dashboard can keep the quotes around it.
  const unquoted = raw.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  return unquoted.replace(/\\n/g, "\n").trim();
}

/**
 * The keys Clerk needs, or null when the app has no Clerk configuration (previews and tests
 * without keys). With a `jwtKey` the Worker checks session tokens without calling Clerk.
 * A key in the wrong shape throws an error that names the variable and never its value.
 */
export function clerkKeysFromEnv(
  raw: Record<string, unknown>,
): ClerkKeys | null {
  const present = Object.fromEntries(
    ["CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_JWT_KEY"]
      .filter((name) => raw[name] !== undefined && raw[name] !== "")
      .map((name) => [name, raw[name]]),
  );
  const result = clerkEnvSchema.safeParse(present);
  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((i) => i.path.join("."))),
    ];
    throw new Error(`Invalid Clerk environment variables: ${names.join(", ")}`);
  }

  const { CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, CLERK_JWT_KEY } =
    result.data;
  if (!CLERK_PUBLISHABLE_KEY || !CLERK_SECRET_KEY) return null;

  return {
    publishableKey: CLERK_PUBLISHABLE_KEY,
    secretKey: CLERK_SECRET_KEY,
    jwtKey: CLERK_JWT_KEY ? normalizeJwtKey(CLERK_JWT_KEY) : undefined,
  };
}
