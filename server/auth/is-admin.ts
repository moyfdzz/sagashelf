import { getAuth } from "@clerk/react-router/server";
import type { LoaderFunctionArgs } from "react-router";

import { findRoleByClerkId } from "../db/roles";
import { getClerkKeys, getDb } from "../runtime-env";

/**
 * Whether the person of the session has the role `admin`, so the header can show the link to the
 * administration (SAG-95). It is a convenience and not a check: the server still refuses every
 * page and every change of the administration to anyone who is not an administrator with a verified
 * Google login (`requireRole('admin')`), so this one does not ask Clerk for the Google login, which
 * would be a call on every page. It costs one small read of `users.role` for a person with a
 * session, and nothing for a visitor.
 *
 * A failure of the database says `false` and is logged by name: a link that is missing for a moment
 * must not break every page.
 */
export async function isAdministrator(
  args: LoaderFunctionArgs,
): Promise<boolean> {
  if (!getClerkKeys()) return false;
  const { userId } = await getAuth(args);
  if (!userId) return false;
  try {
    return (await findRoleByClerkId(await getDb(), userId)) === "admin";
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "nav.admin_check_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return false;
  }
}
