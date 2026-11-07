import { z } from "zod";

import {
  deleteContactMessage,
  setContactMessageStatus,
} from "../db/contact-messages";
import type { SqlExecutor } from "../db/clerk-sync";

/** The forms of the page of messages carry an action and an id. */
export const maxMessagesFormBytes = 1024;

/** What an administrator can do with a message. The id is the one of the message. */
export const messageActionSchema = z.strictObject({
  intent: z.enum(["handled", "reopen", "delete"]),
  id: z.uuid(),
});
export type MessageAction = z.infer<typeof messageActionSchema>;

/** What the page says after an action. Anything else in the address is ignored. */
export const messageNotices = ["handled", "reopened", "deleted"] as const;
export type MessageNotice = (typeof messageNotices)[number];

/** Why an action did not happen: the form could not be read, or the message is gone or was already so. */
export const messageErrors = ["invalid_request", "not_found"] as const;
export type MessageError = (typeof messageErrors)[number];

export const asMessageNotice = (value: string | null): MessageNotice | null =>
  messageNotices.find((notice) => notice === value) ?? null;

export const asMessageError = (value: string | null): MessageError | null =>
  messageErrors.find((error) => error === value) ?? null;

/** A message id taken from the address (the one to confirm deleting), or null. */
export const asMessageId = (value: string | null): string | null => {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * Does what the administrator asked, as the administrator of the session, and says how it went as
 * the query of the address the page goes back to.
 */
export async function runMessageAction(
  db: SqlExecutor,
  actorId: string,
  form: MessageAction,
): Promise<string> {
  const word = (ok: boolean, notice: MessageNotice) =>
    ok ? `notice=${notice}` : "error=not_found";
  if (form.intent === "delete") {
    return word(await deleteContactMessage(db, actorId, form.id), "deleted");
  }
  const handled = form.intent === "handled";
  return word(
    await setContactMessageStatus(
      db,
      actorId,
      form.id,
      handled ? "handled" : "new",
    ),
    handled ? "handled" : "reopened",
  );
}
