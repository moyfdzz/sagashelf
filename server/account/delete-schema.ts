import { z } from "zod";

/**
 * What the person sends to delete the account: their own username, typed as it is shown, and the
 * box that says they understand it cannot be undone. Nothing else is read from the form. The box
 * is not required here: the route answers a missing box with its own error, apart from the
 * username's (SAG-172). The size of the text is limited by the body limit of the route.
 */
export const deleteAccountSchema = z.strictObject({
  confirm: z.string(),
  understood: z.literal("on").optional(),
});

/** Compared without regard to case, like the `citext` column of the username. */
export function confirmsUsername(typed: string, username: string): boolean {
  return typed.trim().toLowerCase() === username.toLowerCase();
}
