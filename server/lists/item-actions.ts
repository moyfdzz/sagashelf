import { z } from "zod";

import type { SqlExecutor } from "../db/clerk-sync";
import {
  addListItem,
  moveListItem,
  removeListItem,
  saveListItemNote,
} from "../db/list-items";
import {
  addToListSchema,
  moveItemSchema,
  noteItemSchema,
  removeItemSchema,
  type ListItemError,
} from "./schema";

/**
 * What a form of the titles inside a list (SAG-113) does. Like `actions.ts`, the person is the one of
 * the session, the list is the one of the address, and a list or a title that is not theirs is the
 * same answer as one that is not there. These forms carry no text of the list, so a refusal gives
 * back no values: the form of the list on the same page keeps the saved ones.
 */

export type ItemActionOutcome =
  | { ok: true; to: string }
  | { ok: false; status: number; error: ListItemError };

const itemSchema = z.discriminatedUnion("intent", [
  removeItemSchema,
  moveItemSchema,
  noteItemSchema,
]);

/** The intents this module answers, read from the schema so they are written once. */
export const itemIntents = itemSchema.options.map(
  (option) => option.shape.intent.value,
);
export type ItemIntent = (typeof itemIntents)[number];

/** So the route knows which module a form is for. */
export const isItemIntent = (value: unknown): value is ItemIntent =>
  itemIntents.some((intent) => intent === value);

const refused = (error: ListItemError, status: number): ItemActionOutcome => ({
  ok: false,
  status,
  error,
});

/** Takes a title out of a list, moves it, or saves its note. */
export async function runItemAction(
  db: SqlExecutor,
  ownerId: string,
  listId: string,
  form: Record<string, FormDataEntryValue>,
): Promise<ItemActionOutcome> {
  const parsed = itemSchema.safeParse(form);
  if (!parsed.success) {
    return refused(
      form.intent === "note_item" ? "invalid_note" : "invalid_item_request",
      400,
    );
  }

  const back = (notice: string) => ({
    ok: true as const,
    // The hash brings the person back to the titles, not to the top of the page.
    to: `/lists/${listId}?notice=${notice}#titles`,
  });
  const data = parsed.data;

  if (data.intent === "remove_item") {
    return (await removeListItem(db, ownerId, listId, data.mediaId))
      ? back("removed")
      : refused("item_not_found", 404);
  }
  if (data.intent === "move_item") {
    return (await moveListItem(
      db,
      ownerId,
      listId,
      data.mediaId,
      data.direction,
    ))
      ? back("moved")
      : refused("item_not_found", 404);
  }
  return (await saveListItemNote(db, ownerId, listId, data.mediaId, data.note))
    ? back("note_saved")
    : refused("item_not_found", 404);
}

export type AddToListOutcome =
  | { ok: true; result: "added" | "already" }
  | {
      ok: false;
      status: number;
      error: "invalid_request" | "limit" | "not_found";
    };

/** The button "Add to a list": a list of the person and a title. */
export async function runAddToList(
  db: SqlExecutor,
  ownerId: string,
  form: Record<string, FormDataEntryValue>,
): Promise<AddToListOutcome> {
  const parsed = addToListSchema.safeParse(form);
  if (!parsed.success)
    return { ok: false, status: 400, error: "invalid_request" };

  const result = await addListItem(
    db,
    ownerId,
    parsed.data.listId,
    parsed.data.mediaId,
  );
  if (result === "added" || result === "already") return { ok: true, result };
  return result === "limit"
    ? { ok: false, status: 409, error: "limit" }
    : { ok: false, status: 404, error: "not_found" };
}
