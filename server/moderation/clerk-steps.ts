import type { ClerkClient } from "@clerk/backend";

import type { AccountState } from "../db/account-actions";

/** What the panel needs of Clerk: the calls that change a picture, ban or release a lock. */
export type ClerkUsers = Pick<
  ClerkClient["users"],
  "deleteUserProfileImage" | "banUser" | "unbanUser" | "unlockUser" | "getUser"
>;

/** The query of the address the panel goes back to: what happened, or why it did not. */
export const notice = (word: string) => `notice=${word}`;
export const error = (word: string) => `error=${word}`;
export const done = (ok: boolean, word: string) =>
  ok ? notice(word) : error("not_found");

/** Clerk refused, and why: the detail travels in the address, so `refusalDetail` keeps it short. */
export const failed = (detail: string) =>
  `error=failed&detail=${encodeURIComponent(detail)}`;

/**
 * Why Clerk refused, for the administrator and for the log (SAG-151): the HTTP status and the codes
 * of its errors, such as `403 feature_not_enabled`, and never the message, which can carry names.
 * An error that is not one of Clerk's gives its name. Only letters, digits, spaces, underscores,
 * dots and dashes are kept, and no more than 60 characters, so it is safe in an address and a log.
 */
export function refusalDetail(thrown: unknown): string {
  const fields = (thrown ?? {}) as {
    status?: unknown;
    errors?: unknown;
    name?: unknown;
  };
  const codes = Array.isArray(fields.errors)
    ? fields.errors.flatMap((entry: { code?: unknown } | null) =>
        typeof entry?.code === "string" ? [entry.code] : [],
      )
    : [];
  const parts = [
    typeof fields.status === "number" ? String(fields.status) : "",
    ...codes.slice(0, 2),
  ].filter(Boolean);
  const text = parts.length
    ? parts.join(" ")
    : typeof fields.name === "string"
      ? fields.name
      : "";
  return text.replace(/[^A-Za-z0-9_. -]/g, "").slice(0, 60) || "error";
}

/**
 * Runs a call to Clerk. Null when it went well. When Clerk refused, the detail of the refusal
 * (`refusalDetail`), which is also logged, and nothing changes here.
 */
export async function viaClerk(
  call: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (thrown) {
    const detail = refusalDetail(thrown);
    console.error("moderation: Clerk refused", detail);
    return detail;
  }
}

/** A suspension is for an active account, and a ban for an account that is not banned yet. */
export const canRestrict = (state: AccountState, bans: boolean) =>
  bans ? state !== "banned" : state === "active";

/**
 * Takes away a lock of Clerk, if there is one. A suspension is kept here and enforced by the app on
 * every request (SAG-148), so it no longer locks the account in Clerk, whose lock expires after an
 * hour by default and shows the person a message that explains nothing. A lock made by an earlier
 * version, or by hand in the dashboard, is released when the account is lifted or banned. Asking
 * first keeps this from failing on an account that is not locked.
 */
export async function releaseLock(
  clerk: ClerkUsers,
  clerkId: string,
): Promise<void> {
  const user = await clerk.getUser(clerkId);
  if (user.locked) await clerk.unlockUser(clerkId);
}

/**
 * The part of Clerk in suspending or banning. A suspension needs nothing there. A ban bans the
 * account in Clerk, which does not expire, after releasing an old lock if the account was suspended,
 * so lifting the ban leaves nothing locked. Null when it went well, or why Clerk refused.
 */
export function stopAccount(
  clerk: ClerkUsers,
  account: { clerkId: string; state: AccountState },
  bans: boolean,
): Promise<string | null> {
  if (!bans) return Promise.resolve(null);
  return viaClerk(async () => {
    if (account.state === "suspended")
      await releaseLock(clerk, account.clerkId);
    return clerk.banUser(account.clerkId);
  });
}
