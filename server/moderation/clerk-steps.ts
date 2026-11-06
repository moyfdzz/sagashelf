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

/**
 * Clerk answers 402 `unsupported_subscription_plan_features` when its plan does not include the
 * ban (seen on 2026-11-06, ADR-041). Only that exact status and code: any other refusal is real.
 */
export function isPlanRefusal(thrown: unknown): boolean {
  const fields = (thrown ?? {}) as { status?: unknown; errors?: unknown };
  return (
    fields.status === 402 &&
    Array.isArray(fields.errors) &&
    fields.errors.some(
      (entry: { code?: unknown } | null) =>
        entry?.code === "unsupported_subscription_plan_features",
    )
  );
}

/** How the part of Clerk went: why it refused, or null, and whether its plan had no ban to make. */
export type ClerkStep = { refused: string | null; skipped: boolean };

const clerkOk: ClerkStep = { refused: null, skipped: false };

/**
 * Runs the call that bans or unbans in Clerk. A plan without the ban is not a refusal: the app
 * enforces the state by itself (SAG-148), so the change carries on here and `skipped` says that
 * Clerk did not apply it. Any other refusal stops the change, as in `viaClerk`.
 */
async function banStep(call: () => Promise<unknown>): Promise<ClerkStep> {
  let skipped = false;
  const refused = await viaClerk(async () => {
    try {
      await call();
    } catch (thrown) {
      if (!isPlanRefusal(thrown)) throw thrown;
      skipped = true;
    }
  });
  return { refused, skipped };
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
 * so lifting the ban leaves nothing locked. Says why Clerk refused, or that its plan has no ban.
 */
export async function stopAccount(
  clerk: ClerkUsers,
  account: { clerkId: string; state: AccountState },
  bans: boolean,
): Promise<ClerkStep> {
  if (!bans) return clerkOk;
  if (account.state === "suspended") {
    const refused = await viaClerk(() => releaseLock(clerk, account.clerkId));
    if (refused !== null) return { refused, skipped: false };
  }
  return banStep(() => clerk.banUser(account.clerkId));
}

/**
 * The part of Clerk in lifting a restriction: a ban is lifted in Clerk (unless its plan has no ban,
 * which `banStep` lets through), a suspension only needs an old lock released.
 */
export async function liftAccount(
  clerk: ClerkUsers,
  account: { clerkId: string; state: AccountState },
): Promise<ClerkStep> {
  if (account.state === "banned") {
    return banStep(() => clerk.unbanUser(account.clerkId));
  }
  const refused = await viaClerk(() => releaseLock(clerk, account.clerkId));
  return { refused, skipped: false };
}
