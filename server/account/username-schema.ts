import { z } from "zod";

import { usernameSchema } from "./profile-schema";

/** One change every 30 days (SAG-37). */
export const usernameCooldownDays = 30;

/**
 * What the person sends to change the username. The base rules (3 to 30 characters, no spaces,
 * not a reserved name) are in `usernameSchema`; a change is stricter: ASCII letters, digits and
 * the underscore only, and not numbers alone. Clerk applies its own rules after this.
 */
export const usernameChangeSchema = z.strictObject({
  username: usernameSchema
    .regex(/^[A-Za-z0-9_]+$/, { message: "username_invalid" })
    .refine((value) => !/^\d+$/.test(value), {
      message: "username_invalid",
    }),
});

/**
 * The first moment a person may change the username again, or null when they may do it now.
 * `changedAt` is null for someone who never changed it.
 */
export function usernameAvailableAt(
  changedAt: Date | null,
  now: Date = new Date(),
): Date | null {
  if (!changedAt) return null;
  const next = new Date(
    changedAt.getTime() + usernameCooldownDays * 24 * 60 * 60 * 1000,
  );
  return next > now ? next : null;
}
