import { getAuth } from "@clerk/react-router/server";
import { createClerkClient } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { data, redirectDocument, type LoaderFunctionArgs } from "react-router";

import { authorize, type Role, type SessionUser } from "./authorize";
import { signInPath } from "./sign-in-url";

/** Where a suspended or banned person is sent: a page that says why and lets them sign out. */
export const restrictedPath = "/account-restricted";
import { getClerkKeys, getDb } from "../runtime-env";
import { users } from "../db/schema";

async function findUser(clerkId: string): Promise<SessionUser | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: users.id,
      clerkId: users.clerkId,
      role: users.role,
      status: users.moderationStatus,
    })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!row) return null;
  const { status, ...user } = row;
  return status === "active" ? user : { ...user, restricted: true };
}

async function hasVerifiedGoogle(clerkId: string): Promise<boolean> {
  const keys = getClerkKeys();
  if (!keys) return false;
  const user = await createClerkClient({
    secretKey: keys.secretKey,
    publishableKey: keys.publishableKey,
  }).users.getUser(clerkId);
  return user.externalAccounts.some(
    (account) =>
      account.provider === "oauth_google" &&
      account.verification?.status === "verified",
  );
}

async function guard(args: LoaderFunctionArgs, role?: Role) {
  if (!getClerkKeys()) {
    // A deployment without Clerk keys must never let anyone in.
    throw data({ error: "auth_not_configured" }, { status: 503 });
  }

  const { userId } = await getAuth(args);
  const result = await authorize(userId, { findUser, hasVerifiedGoogle }, role);
  if (result.ok) return result.user;

  if (result.reason === "signed_out") {
    // A whole new page, not a move inside this one: the sign-in page has its own, wider CSP,
    // which only a new document gets. From a form sent in the background, a move inside the
    // page would leave a blank screen.
    throw redirectDocument(signInPath(args.request.url));
  }
  if (result.reason === "restricted") {
    // A page that says why, and lets the person sign out. A whole new document, like the sign-in.
    throw redirectDocument(restrictedPath);
  }
  // Same answer for "no account" and "wrong role": it does not tell which one failed.
  throw data({ error: "forbidden" }, { status: 403 });
}

/**
 * The signed-in user from our own table, or null for a visitor with no session or no account.
 * For a public page that shows a little more to a person who is signed in.
 */
export async function getOptionalUser(
  args: LoaderFunctionArgs,
): Promise<SessionUser | null> {
  if (!getClerkKeys()) return null;
  const { userId } = await getAuth(args);
  if (!userId) return null;
  const user = await findUser(userId);
  // A restricted person is a visitor for the pages that only look at who is signed in.
  return user?.restricted ? null : user;
}

/** The signed-in user from our own table, or a redirect to sign in, or 403. */
export function requireUser(args: LoaderFunctionArgs) {
  return guard(args);
}

/** Like `requireUser`, and the user must have `role`. The admin also needs a verified Google login. */
export function requireRole(args: LoaderFunctionArgs, role: Role) {
  return guard(args, role);
}
