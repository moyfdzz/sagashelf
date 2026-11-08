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
/** How many titles a list may hold, checked in the statement that adds one. */
export const maxListItems = 200;
export const maxItemNote = 500;

/** Who may see a list, from the widest to the narrowest. The profile can only narrow it further. */
export const listVisibilities = ["public", "friends", "private"] as const;
export type ListVisibility = (typeof listVisibilities)[number];

/** A title of 100 characters can take four bytes each; the form has a few more fields. */
export const maxListsFormBytes = 4 * 1024;

const characters = (text: string) => [...text].length;

// A browser counts a new line in a textarea as one character for `maxlength` but sends it as `\r\n`,
// which is two; the database counts what is saved. Saving `\n` makes the two counts agree, so a text
// the page let the person write is never refused as too long. Used by every textarea of the lists.
const newLines = (text: string) => text.replace(/\r\n?/g, "\n");

const title = z
  .string()
  .trim()
  .refine((text) => characters(text) >= 1 && characters(text) <= maxListTitle);

// An empty description is no description: the column holds null, not an empty text.
const description = z
  .string()
  .trim()
  .transform(newLines)
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

const mediaId = z.uuid();

// An empty note is no note: the column holds null, not an empty text.
const itemNote = z
  .string()
  .trim()
  .transform(newLines)
  .refine((text) => characters(text) <= maxItemNote)
  .transform((text) => (text === "" ? null : text));

/** The forms of the titles inside a list (SAG-113). The list is the one of the address. */
export const removeItemSchema = z.strictObject({
  intent: z.literal("remove_item"),
  mediaId,
});

export const moveItemSchema = z.strictObject({
  intent: z.literal("move_item"),
  mediaId,
  direction: z.enum(["up", "down"]),
});

export const noteItemSchema = z.strictObject({
  intent: z.literal("note_item"),
  mediaId,
  note: itemNote,
});

/** The button "Add to a list" of the title page and of the entry of the library. */
export const addToListSchema = z.strictObject({
  listId: z.uuid(),
  mediaId,
});

export type ListFields = {
  title: string;
  description: string | null;
  visibility: ListVisibility;
};

/** What the page says after an action. Anything else in the address is ignored. */
export const listNotices = [
  "created",
  "saved",
  "deleted",
  "removed",
  "moved",
  "note_saved",
] as const;
export type ListNotice = (typeof listNotices)[number];

export const asListNotice = (value: string | null): ListNotice | null =>
  listNotices.find((notice) => notice === value) ?? null;

/** Why a form did not do what it asked. The first two are the person's to fix. */
export type ListError = "invalid_request" | "duplicate" | "limit" | "not_found";

/**
 * Why a form of the titles inside a list did not do what it asked. These belong above the titles, and
 * none of them is a `ListError`: the page tells the two apart with `isListItemError`, so a refusal of
 * a title is never written above the form that edits the list.
 */
export const listItemErrors = [
  "invalid_item_request",
  "invalid_note",
  "item_not_found",
] as const;
export type ListItemError = (typeof listItemErrors)[number];

export const isListItemError = (value: unknown): value is ListItemError =>
  listItemErrors.some((error) => error === value);
