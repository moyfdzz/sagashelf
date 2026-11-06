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
