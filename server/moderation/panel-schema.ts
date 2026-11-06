import { z } from "zod";

/** The forms of the panel carry an action, an id and at most a reason, nothing else. */
export const maxModerationFormBytes = 1024;

const answer = <Intent extends string>(intent: Intent) =>
  z.strictObject({ intent: z.literal(intent), id: z.uuid() });

/**
 * What an administrator can do from the panel. The id is the one of a report, except for `lift`,
 * which names the account. The reason of a warning is checked against the kind of the report by the
 * route, which has read it.
 */
export const moderationActionSchema = z.discriminatedUnion("intent", [
  answer("dismiss"),
  answer("restore"),
  answer("remove"),
  answer("suspend"),
  answer("ban"),
  answer("lift"),
  z.strictObject({
    intent: z.literal("warn"),
    id: z.uuid(),
    reason: z.string().max(40),
  }),
]);

/** The actions that ask to be confirmed in a modal first, because they cannot be taken back here. */
export const confirmedActions = ["remove", "suspend", "ban"] as const;
export type ConfirmedAction = (typeof confirmedActions)[number];

export const asConfirmedAction = (
  value: string | null,
): ConfirmedAction | null =>
  confirmedActions.find((action) => action === value) ?? null;

/** What the page says after an action. Anything else in the address is ignored. */
export const moderationNotices = [
  "dismissed",
  "restored",
  "removed",
  "warned",
  "suspended",
  "banned",
  "lifted",
] as const;
export type ModerationNotice = (typeof moderationNotices)[number];

/**
 * Why an action did not happen: the report was answered already or is not what the action needs
 * (`not_found`), the person changed their picture since (`outdated`), the account is an
 * administrator or is the administrator's own (`not_allowed`), the picture is hidden and must be
 * restored or removed before a warning (`picture_hidden`), or Clerk refused (`failed`).
 */
export const moderationErrors = [
  "invalid_request",
  "not_found",
  "outdated",
  "not_allowed",
  "picture_hidden",
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

/** A report id taken from the address (the picture to show, the action to confirm), or null. */
export const asReportId = (value: string | null): string | null => {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};
