import { z } from "zod";

import type { SqlExecutor } from "../db/clerk-sync";
import { createList, deleteList, updateList } from "../db/lists";
import {
  createListSchema,
  deleteListSchema,
  saveListSchema,
  type ListError,
} from "./schema";

/** What the form had, as text, so a form that was refused comes back with what the person wrote. */
export type ListFormValues = {
  title: string;
  description: string;
  visibility: string;
};

export type ListActionOutcome =
  | { ok: true; to: string }
  | { ok: false; status: number; error: ListError; values: ListFormValues };

type Form = Record<string, FormDataEntryValue>;

const text = (value: FormDataEntryValue | undefined) =>
  typeof value === "string" ? value : "";

const valuesOf = (form: Form): ListFormValues => ({
  title: text(form.title),
  description: text(form.description),
  visibility: text(form.visibility),
});

const refused = (
  form: Form,
  error: ListError,
  status: number,
): ListActionOutcome => ({ ok: false, status, error, values: valuesOf(form) });

/** A list id taken from the address. Anything that is not an id is a list that is not there. */
export const asListId = (value: string | undefined): string | null => {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** Creates a list of the person of the session and goes to it. */
export async function runCreateList(
  db: SqlExecutor,
  ownerId: string,
  form: Form,
): Promise<ListActionOutcome> {
  const parsed = createListSchema.safeParse(form);
  if (!parsed.success) return refused(form, "invalid_request", 400);

  const { title, description, visibility } = parsed.data;
  const result = await createList(db, ownerId, {
    title,
    description,
    visibility,
  });
  if (result.outcome === "created") {
    return { ok: true, to: `/lists/${result.id}?notice=created` };
  }
  return refused(form, result.outcome, 409);
}

const detailSchema = z.discriminatedUnion("intent", [
  saveListSchema,
  deleteListSchema,
]);

/** Saves or deletes one list of the person of the session. */
export async function runListAction(
  db: SqlExecutor,
  ownerId: string,
  id: string,
  form: Form,
): Promise<ListActionOutcome> {
  const parsed = detailSchema.safeParse(form);
  if (!parsed.success) return refused(form, "invalid_request", 400);

  if (parsed.data.intent === "delete") {
    return (await deleteList(db, ownerId, id))
      ? { ok: true, to: "/lists?notice=deleted" }
      : refused(form, "not_found", 404);
  }

  const { title, description, visibility } = parsed.data;
  const result = await updateList(db, ownerId, id, {
    title,
    description,
    visibility,
  });
  if (result === "saved") return { ok: true, to: `/lists/${id}?notice=saved` };
  return result === "duplicate"
    ? refused(form, "duplicate", 409)
    : refused(form, "not_found", 404);
}
