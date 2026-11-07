import { z } from "zod";

// What the contact page and its administration agree on (SAG-110). Pure: no database, so the page,
// the loaders and the tests can all import it.

export const contactKinds = ["feedback", "problem", "help"] as const;
export type ContactKind = (typeof contactKinds)[number];

export const isContactKind = (value: unknown): value is ContactKind =>
  typeof value === "string" &&
  (contactKinds as readonly string[]).includes(value);

/** The longest message, in characters. The table checks it too. */
export const maxContactBody = 2000;

/** The longest address a visitor can leave to be answered at (the limit of an email address). */
export const maxReplyEmail = 254;

/** A signed-in person can send this many messages a day. */
export const dailyMemberCap = 5;

/** Visitors, all together, can send this many a day. Nobody is told who sent what. */
export const dailyVisitorCap = 50;

/** Messages are deleted this many days after they were sent, handled or not. */
export const contactRetentionDays = 90;

/** The type of the notification an administrator gets for a new message. The table allows it. */
export const contactCreatedType = "contact.created";

/**
 * What the notification of a message says, from its payload, or null when it is not readable: only
 * the kind. Never the text and never who wrote it.
 */
export function contactNotice(payload: Record<string, unknown>) {
  const { kind } = payload;
  return isContactKind(kind) ? { kind } : null;
}

/** The name of the field that only a bot fills in: it is hidden from people (SAG-110). */
export const contactTrapField = "website";

/**
 * The form of the contact page. The kind is one of the three, the text has 1 to 2000 characters
 * after trimming, and the address is optional and must look like one. The trap field is read by the
 * route, which answers as if the message was sent when it is not empty. A field that is not here
 * is refused, so a form cannot carry anything else.
 */
export const contactFormSchema = z.strictObject({
  kind: z.enum(contactKinds),
  body: z.string().trim().min(1).max(maxContactBody),
  replyEmail: z
    .string()
    .trim()
    .max(maxReplyEmail)
    .optional()
    .transform((value) => value || null)
    .refine((value) => value === null || z.email().safeParse(value).success),
  [contactTrapField]: z.string().max(500).optional(),
});

/** Why a form was refused, as the page says it: the text, the address, or anything else. */
export type ContactFormError =
  "body_invalid" | "email_invalid" | "invalid_request";

export function contactFormError(error: z.ZodError): ContactFormError {
  const fields = new Set(error.issues.map((issue) => issue.path[0]));
  if (fields.has("body")) return "body_invalid";
  if (fields.has("replyEmail")) return "email_invalid";
  return "invalid_request";
}
