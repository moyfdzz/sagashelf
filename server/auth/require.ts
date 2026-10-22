import { getAuth } from "@clerk/react-router/server";
import { createClerkClient } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { data, redirect, type LoaderFunctionArgs } from "react-router";

import { authorize, type Role, type SessionUser } from "./authorize";
import { getClerkKeys, getDb } from "../runtime-env";
import { users } from "../db/schema";

async function findUser(clerkId: string): Promise<SessionUser | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id, clerkId: users.clerkId, role: users.role })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return row ?? null;
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
    const { pathname, search } = new URL(args.request.url);
    throw redirect(
      `/sign-in?redirectTo=${encodeURIComponent(pathname + search)}`,
    );
  }
  // Same answer for "no account" and "wrong role": it does not tell which one failed.
  throw data({ error: "forbidden" }, { status: 403 });
}

/** The signed-in user from our own table, or a redirect to sign in, or 403. */
export function requireUser(args: LoaderFunctionArgs) {
  return guard(args);
}

/** Like `requireUser`, and the user must have `role`. The admin also needs a verified Google login. */
export function requireRole(args: LoaderFunctionArgs, role: Role) {
  return guard(args, role);
}
