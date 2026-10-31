import { z } from "zod";

/** The forms of the curation screen are short; anything bigger is not from it. */
export const maxAdminFormBytes = 2048;

const name = z.string().trim().min(1).max(80);

/** A Wikidata item as a person pastes it: `Q42`, `q42` or its address. */
const qid = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value.split("/").pop() ?? "").toUpperCase())
  .pipe(z.string().regex(/^Q[0-9]{1,12}$/));

export const createSagaSchema = z.strictObject({
  intent: z.literal("create"),
  titleEs: name,
  titleEn: name,
});

/** What a person can do on the page of one saga. */
export const sagaActionSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("publish") }),
  z.strictObject({ intent: z.literal("unpublish") }),
  z.strictObject({
    intent: z.literal("rename"),
    titleEs: name,
    titleEn: name,
  }),
  z.strictObject({ intent: z.literal("add"), qid }),
  z.strictObject({ intent: z.literal("remove"), qid }),
  z.strictObject({
    intent: z.literal("move"),
    qid,
    direction: z.enum(["up", "down"]),
  }),
]);

/** Why a change did not happen, as the page says it. Anything else in the address is ignored. */
export const adminErrors = [
  "invalid_request",
  "slug_taken",
  "not_found",
  "already_there",
  "nothing_to_move",
] as const;
export type AdminError = (typeof adminErrors)[number];

export const asAdminError = (value: string | null): AdminError | null =>
  adminErrors.find((error) => error === value) ?? null;
