import { z } from "zod";

import { usernameShape } from "../account/profile-schema";

/** The forms of the panel carry an action, an id or a username, a reason and a short note. */
export const maxModerationFormBytes = 2048;

/** The longest internal note. Only the audit log keeps it, and the person never sees it. */
export const maxNoteLength = 200;

/** A username as the form or the address gives it, or null if it cannot be one. */
export const asPersonName = (value: string | null): string | null => {
  const name = value?.trim() ?? "";
  return usernameShape.test(name) ? name : null;
};

const personName = z.string().trim().regex(usernameShape);

/** An internal note: only the audit log keeps it, and an empty one is none. */
const note = z
  .string()
  .trim()
  .max(maxNoteLength)
  .optional()
  .transform((value) => value || null);

const answer = <Intent extends string>(intent: Intent) =>
  z.strictObject({ intent: z.literal(intent), id: z.uuid() });

/**
 * What an administrator can do from the panel. The id is the one of a report, except for `lift`,
 * which names the account. The reason of a warning is checked against the kind of the report by the
 * route, which has read it. The `_person` actions (SAG-146) are about a person named by username,
 * with no report: the server finds the person, and the form never carries their id.
 */
export const moderationActionSchema = z.discriminatedUnion("intent", [
  answer("dismiss"),
  answer("restore"),
  answer("remove"),
  answer("suspend"),
  answer("ban"),
  // `username` only says which card of the panel to show again afterwards.
  z.strictObject({
    intent: z.literal("lift"),
    id: z.uuid(),
    username: personName.optional(),
  }),
  z.strictObject({
    intent: z.literal("warn"),
    id: z.uuid(),
    reason: z.string().max(40),
  }),
  z.strictObject({
    intent: z.literal("warn_person"),
    username: personName,
    reason: z.string().max(40),
    note,
  }),
  z.strictObject({
    intent: z.literal("suspend_person"),
    username: personName,
    note,
  }),
  z.strictObject({
    intent: z.literal("ban_person"),
    username: personName,
    note,
  }),
]);

/** The actions that ask to be confirmed in a modal first, because they cannot be taken back here. */
export const confirmedActions = ["remove", "suspend", "ban"] as const;
export type ConfirmedAction = (typeof confirmedActions)[number];

export const asConfirmedAction = (
  value: string | null,
): ConfirmedAction | null =>
  confirmedActions.find((action) => action === value) ?? null;

/** The actions on a person with no report that ask to be confirmed: a picture is not theirs here. */
export const asPersonConfirm = (
  value: string | null,
): "suspend" | "ban" | null => {
  const action = asConfirmedAction(value);
  return action === "suspend" || action === "ban" ? action : null;
};

/** What the page says after an action. Anything else in the address is ignored. */
export const moderationNotices = [
  "dismissed",
  "restored",
  "removed",
  "warned",
  "suspended",
  "banned",
  "banned_no_clerk",
  "lifted",
  "lifted_no_clerk",
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

/**
 * The detail of a refusal of Clerk, as the address gives it (SAG-151). It is only drawn as text,
 * but it comes from the address: only a short string of safe characters is taken.
 */
export const asModerationDetail = (value: string | null): string | null =>
  value !== null && /^[A-Za-z0-9_. -]{1,60}$/.test(value) ? value : null;

/** A report id taken from the address (the picture to show, the action to confirm), or null. */
export const asReportId = (value: string | null): string | null => {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};
