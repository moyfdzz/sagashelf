import type { ClerkClient } from "@clerk/backend";

import type { AccountState } from "../db/account-actions";

/** What the panel needs of Clerk: the calls that change a picture or stop a sign-in. */
export type ClerkUsers = Pick<
  ClerkClient["users"],
  "deleteUserProfileImage" | "banUser" | "unbanUser" | "lockUser" | "unlockUser"
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
 * Stops the sign-in in Clerk: a lock for a suspension, a ban for a ban. A suspended account is
 * unlocked before it is banned, so lifting the ban leaves nothing locked. False when Clerk refused.
 */
export function stopAccount(
  clerk: ClerkUsers,
  account: { clerkId: string; state: AccountState },
  bans: boolean,
): Promise<boolean> {
  return viaClerk(async () => {
    if (!bans) return clerk.lockUser(account.clerkId);
    if (account.state === "suspended") await clerk.unlockUser(account.clerkId);
    return clerk.banUser(account.clerkId);
  });
}
