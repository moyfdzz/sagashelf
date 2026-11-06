import type { z } from "zod";

import { isReportReason, reasonsOf } from "../account/report-schema";
import {
  findReportedPerson,
  findRestrictedAccount,
  liftRestriction,
  restrictAccount,
  warnPerson,
} from "../db/account-actions";
import type { SqlExecutor } from "../db/clerk-sync";
import {
  dismissReport,
  findPictureReport,
  recordPictureRemoved,
  restorePicture,
} from "../db/moderation";
import {
  canRestrict,
  done,
  error,
  releaseLock,
  stopAccount,
  viaClerk,
  type ClerkUsers,
} from "./clerk-steps";
import type { moderationActionSchema } from "./panel-schema";
import { runPersonAction } from "./run-person-action";

export type { ClerkUsers } from "./clerk-steps";

export type ModerationForm = z.infer<typeof moderationActionSchema>;

/**
 * Does what an administrator asked from the panel (SAG-143, SAG-146, ADR-039, ADR-040) and says how it went,
 * as the query of the address the page goes back to. `actorId` is the administrator of the session.
 * Where Clerk has a part, it goes first: if it refuses, nothing is written here, and if the write
 * here fails after Clerk did, asking again repeats Clerk's call, which changes nothing, and writes.
 */
export async function runModerationAction(
  db: SqlExecutor,
  clerk: ClerkUsers,
  actorId: string,
  form: ModerationForm,
): Promise<string> {
  // A person named by username, with no report.
  if (
    form.intent === "warn_person" ||
    form.intent === "suspend_person" ||
    form.intent === "ban_person"
  ) {
    return runPersonAction(db, clerk, actorId, form);
  }
  const { intent, id } = form;

  if (intent === "dismiss") {
    return done(await dismissReport(db, actorId, id), "dismissed");
  }
  if (intent === "restore") {
    return done(await restorePicture(db, actorId, id), "restored");
  }

  if (intent === "remove") {
    // Removing deletes the picture in Clerk, so it cannot come back with a later event. Only the
    // picture that was reported: a newer one is the person's and this report says nothing about it.
    const report = await findPictureReport(db, id);
    if (!report) return error("not_found");
    if (!report.current) return error("outdated");
    let changed: Awaited<ReturnType<ClerkUsers["deleteUserProfileImage"]>>;
    try {
      changed = await clerk.deleteUserProfileImage(report.clerkId);
    } catch (thrown) {
      console.error("moderation: Clerk refused", (thrown as Error).name);
      return error("failed");
    }
    return done(
      await recordPictureRemoved(db, actorId, id, {
        avatarUrl: changed.imageUrl.startsWith("https://")
          ? changed.imageUrl
          : null,
        hasOwnPicture: changed.hasImage,
        updatedAt: new Date(changed.updatedAt),
      }),
      "removed",
    );
  }

  if (intent === "lift") {
    // Here the id is the account's, from the list of restricted accounts.
    const account = await findRestrictedAccount(db, id);
    if (!account) return error("not_found");
    const lifted = await viaClerk(() =>
      account.state === "banned"
        ? clerk.unbanUser(account.clerkId)
        : releaseLock(clerk, account.clerkId),
    );
    if (!lifted) return error("failed");
    const result = done(await liftRestriction(db, actorId, id), "lifted");
    // Lifted from the card of a person: the card is shown again.
    return form.intent === "lift" && form.username
      ? `person=${encodeURIComponent(form.username)}&${result}`
      : result;
  }

  // The rest is about the person of an open report.
  const person = await findReportedPerson(db, actorId, id);
  if (!person) return error("not_found");
  if (person.protected) return error("not_allowed");

  if (intent === "warn") {
    if (person.pictureHidden) return error("picture_hidden");
    // The reason is one of the list of the kind of the report, never free text.
    if (
      !isReportReason(form.reason) ||
      !reasonsOf(person.kind).includes(form.reason)
    ) {
      return error("invalid_request");
    }
    return done(
      await warnPerson(db, actorId, { reportId: id }, form.reason),
      "warned",
    );
  }

  // Suspend (an active account) or ban (an active or a suspended one).
  const bans = intent === "ban";
  if (!canRestrict(person.state, bans)) return error("not_found");
  if (!(await stopAccount(clerk, person, bans))) return error("failed");
  const state = bans ? "banned" : "suspended";
  return done(
    await restrictAccount(db, actorId, { reportId: id }, state),
    state,
  );
}
