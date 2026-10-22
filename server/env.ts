import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["development", "preview", "production"]),
  // A Workers secret. Optional until the first form that needs it exists (SAG-10).
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  // The Neon connection string, a Workers secret (pooled, for the HTTP driver). Optional so
  // previews and tests start without it; `getDb()` fails with a clear message if it is needed.
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//)
    .optional(),
  // Clerk (SAG-10). Optional so previews and tests start without them; the auth guards
  // fail with a clear message if they are needed. The publishable and JWT public keys are
  // public values; the secret key is a Workers secret.
  CLERK_PUBLISHABLE_KEY: z
    .string()
    .regex(/^pk_(test|live)_/)
    .optional(),
  CLERK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_/)
    .optional(),
  // The instance's PEM public key: lets the Worker verify sessions without a network call.
  CLERK_JWT_KEY: z.string().min(1).optional(),
  // The Svix signing secret of the Clerk webhook endpoint (SAG-11), a Workers secret.
  CLERK_WEBHOOK_SIGNING_SECRET: z
    .string()
    .regex(/^whsec_/)
    .optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Validates raw Worker bindings. Errors name the variables that failed and
 * never include their values, so a bad secret cannot leak into logs.
 */
export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const names = [
    ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
  ];
  throw new Error(
    `Invalid or missing environment variables: ${names.join(", ")}`,
  );
}
