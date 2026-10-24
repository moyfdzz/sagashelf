import { z } from "zod";

/**
 * What the person sends to delete the account: their own username, typed as it is shown, and the
 * box that says they understand it cannot be undone. Nothing else is read from the form.
 */
export const deleteAccountSchema = z.strictObject({
  confirm: z.string().trim().min(1).max(64),
  understood: z.literal("on"),
});

/** Compared without regard to case, like the `citext` column of the username. */
export function confirmsUsername(typed: string, username: string): boolean {
  return typed.trim().toLowerCase() === username.toLowerCase();
}
