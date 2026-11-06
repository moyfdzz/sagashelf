import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/react-router/server";
import { data, redirectDocument } from "react-router";

import type { Route } from "./+types/settings.delete";
import {
  confirmsUsername,
  deleteAccountSchema,
} from "~server/account/delete-schema";
import { clearSessionCookies } from "~server/auth/clear-session-cookies";
import { requireUser } from "~server/auth/require";
import { eraseAccount } from "~server/db/erase-user";
import { getProfile } from "~server/db/profile";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";
import { readForm } from "~server/http/body";
import { privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has a short text and a box. Anything bigger is not from this page.
const maxFormBytes = 1024;

// Each code has its text in app/locales, under settings.delete.errors.
type ErrorCode =
  "confirm_mismatch" | "reauth_required" | "failed" | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

// Only the form of the settings page deletes an account, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to delete someone's account.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("invalid_request", 413)
      : fail("invalid_request", 403);
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  // The person must have signed in recently (the first factor, within 10 minutes). A session
  // left open on a shared computer cannot erase an account. The person signs in again and tries
  // again; the sign-in page is the only one that handles a password.
  const { has } = await getAuth(args);
  if (!has({ reverification: "strict" })) {
    return fail("reauth_required", 403);
  }

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `delete:${user.id}`,
  );
  if (limited) return limited;

  const parsed = deleteAccountSchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) throw data({ error: "forbidden" }, { status: 403 });
  if (
    !parsed.success ||
    !confirmsUsername(parsed.data.confirm, profile.username)
  ) {
    return fail("confirm_mismatch", 400);
  }

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  // Clerk first: if it fails nothing was erased and the person can try again. If our erasure
  // fails after Clerk deleted the account, Clerk's `user.deleted` event erases it a moment
  // later (Svix retries), so the account never stays half deleted.
  const clerk = createClerkClient({
    secretKey: keys.secretKey,
    publishableKey: keys.publishableKey,
  });
  // The picture goes first and on its own: Clerk does not say what happens to the file when an
  // account is deleted (ADR-037). A person with no picture of their own may get a refusal here,
  // and that must not stop the deletion.
  try {
    await clerk.users.deleteUserProfileImage(user.clerkId);
  } catch (error) {
    console.error("account deletion: picture", (error as Error).name);
  }
  try {
    await clerk.users.deleteUser(user.clerkId);
  } catch (error) {
    console.error("account deletion: Clerk refused", (error as Error).name);
    return fail("failed", 502);
  }
  try {
    await eraseAccount(db, user.clerkId);
  } catch (error) {
    console.error(
      "account deletion: local erasure failed",
      (error as Error).name,
    );
  }

  // A whole new document: the session is gone and Clerk's script must start clean. The session
  // cookies are expired too: their token would verify for up to a minute and the header would
  // still show the person as signed in.
  const headers = new Headers(privateHeaders);
  for (const cookie of clearSessionCookies(request)) {
    headers.append("Set-Cookie", cookie);
  }
  return redirectDocument("/", { headers });
}
