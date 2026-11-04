import { getAuth } from "@clerk/react-router/server";
import type { LoaderFunctionArgs } from "react-router";

import { countUnreadByClerkId } from "../db/notifications";
import { getClerkKeys, getDb } from "../runtime-env";

/**
 * How many unread notifications the person of the session has, for the link in the header (SAG-102).
 * It is a convenience and not a check, like `isAdministrator`: one small read for a person with a
 * session and nothing for a visitor, and the page of the inbox asks for its own data. A failure of
 * the database says 0 and is logged by name, since a number that is missing for a moment must not
 * break every page.
 */
export async function unreadNotifications(
  args: LoaderFunctionArgs,
): Promise<number> {
  if (!getClerkKeys()) return 0;
  const { userId } = await getAuth(args);
  if (!userId) return 0;
  try {
    return await countUnreadByClerkId(await getDb(), userId);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "nav.unread_check_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return 0;
  }
}
