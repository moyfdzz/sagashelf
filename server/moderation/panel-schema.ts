import { z } from "zod";

/** The forms of the panel carry an action and an id, nothing else. */
export const maxModerationFormBytes = 1024;

export const moderationActionSchema = z.strictObject({
  intent: z.enum(["dismiss", "restore", "remove"]),
  id: z.uuid(),
});

/** What the page says after an action. Anything else in the address is ignored. */
export const moderationNotices = ["dismissed", "restored", "removed"] as const;
export type ModerationNotice = (typeof moderationNotices)[number];

/**
 * Why an action did not happen: the report was answered already or is not what the action needs
 * (`not_found`), the person changed their picture since (`outdated`), or Clerk refused (`failed`).
 */
export const moderationErrors = [
  "invalid_request",
  "not_found",
  "outdated",
  "failed",
] as const;
export type ModerationError = (typeof moderationErrors)[number];

export const asModerationNotice = (
  value: string | null,
): ModerationNotice | null =>
  moderationNotices.find((notice) => notice === value) ?? null;

export const asModerationError = (
  value: string | null,
): ModerationError | null =>
  moderationErrors.find((error) => error === value) ?? null;

/** A report id taken from the address (the picture to show, the removal to confirm), or null. */
export const asReportId = (value: string | null): string | null => {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};
