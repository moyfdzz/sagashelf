import { z } from "zod";

/**
 * The lists of a person (SAG-113, ADR-045). What a form of the lists may carry, and the limits. The
 * lengths are the ones of the table (`lists_title_length_check`, `lists_description_length_check`),
 * counted in characters like the database does: an emoji is one.
 */

/** How many lists a person may have. Checked in the same statement that creates one. */
export const maxLists = 50;
export const maxListTitle = 100;
export const maxListDescription = 500;

/** Who may see a list, from the widest to the narrowest. The profile can only narrow it further. */
export const listVisibilities = ["public", "friends", "private"] as const;
export type ListVisibility = (typeof listVisibilities)[number];

/** A title of 100 characters can take four bytes each; the form has a few more fields. */
export const maxListsFormBytes = 4 * 1024;

const characters = (text: string) => [...text].length;

const title = z
  .string()
  .trim()
  .refine((text) => characters(text) >= 1 && characters(text) <= maxListTitle);

// An empty description is no description: the column holds null, not an empty text.
const description = z
  .string()
  .trim()
  .refine((text) => characters(text) <= maxListDescription)
  .transform((text) => (text === "" ? null : text));

const visibility = z.enum(listVisibilities);

export const createListSchema = z.strictObject({
  intent: z.literal("create"),
  title,
  description,
  visibility,
});

export const saveListSchema = z.strictObject({
  intent: z.literal("save"),
  title,
  description,
  visibility,
});

export const deleteListSchema = z.strictObject({
  intent: z.literal("delete"),
});

export type ListFields = {
  title: string;
  description: string | null;
  visibility: ListVisibility;
};

/** What the page says after an action. Anything else in the address is ignored. */
export const listNotices = ["created", "saved", "deleted"] as const;
export type ListNotice = (typeof listNotices)[number];

export const asListNotice = (value: string | null): ListNotice | null =>
  listNotices.find((notice) => notice === value) ?? null;

/** Why a form did not do what it asked. The first two are the person's to fix. */
export type ListError = "invalid_request" | "duplicate" | "limit" | "not_found";
