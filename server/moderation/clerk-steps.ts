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

/** Runs a call to Clerk. A refusal is told as `failed` and nothing changes here. */
export async function viaClerk(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return true;
  } catch (thrown) {
    console.error("moderation: Clerk refused", (thrown as Error).name);
    return false;
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
 * so lifting the ban leaves nothing locked. False when Clerk refused.
 */
export function stopAccount(
  clerk: ClerkUsers,
  account: { clerkId: string; state: AccountState },
  bans: boolean,
): Promise<boolean> {
  if (!bans) return Promise.resolve(true);
  return viaClerk(async () => {
    if (account.state === "suspended")
      await releaseLock(clerk, account.clerkId);
    return clerk.banUser(account.clerkId);
  });
}
