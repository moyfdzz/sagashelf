import type { ClerkClient } from "@clerk/backend";

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
import type { z } from "zod";
import type { moderationActionSchema } from "./panel-schema";

/** What the panel needs of Clerk: the calls that change a picture or stop a sign-in. */
export type ClerkUsers = Pick<
  ClerkClient["users"],
  "deleteUserProfileImage" | "banUser" | "unbanUser" | "lockUser" | "unlockUser"
>;

export type ModerationForm = z.infer<typeof moderationActionSchema>;

const notice = (word: string) => `notice=${word}`;
const error = (word: string) => `error=${word}`;
const done = (ok: boolean, word: string) =>
  ok ? notice(word) : error("not_found");

/** Runs a call to Clerk. A refusal is told as `failed` and nothing changes here. */
async function viaClerk(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return true;
  } catch (thrown) {
    console.error("moderation: Clerk refused", (thrown as Error).name);
    return false;
  }
}

/**
 * Does what an administrator asked from the panel (SAG-143, ADR-039, ADR-040) and says how it went,
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
        : clerk.unlockUser(account.clerkId),
    );
    if (!lifted) return error("failed");
    return done(await liftRestriction(db, actorId, id), "lifted");
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
    return done(await warnPerson(db, actorId, id, form.reason), "warned");
  }

  // Suspend (an active account) or ban (an active or a suspended one, which is unlocked first so the
  // lift of the ban leaves nothing locked in Clerk).
  const bans = intent === "ban";
  if (person.state === "banned" || (!bans && person.state !== "active")) {
    return error("not_found");
  }
  const stopped = await viaClerk(async () => {
    if (!bans) return clerk.lockUser(person.clerkId);
    if (person.state === "suspended") await clerk.unlockUser(person.clerkId);
    return clerk.banUser(person.clerkId);
  });
  if (!stopped) return error("failed");
  return done(
    await restrictAccount(db, actorId, id, bans ? "banned" : "suspended"),
    bans ? "banned" : "suspended",
  );
}
