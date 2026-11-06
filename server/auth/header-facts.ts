import { getAuth } from "@clerk/react-router/server";
import type { LoaderFunctionArgs } from "react-router";

import { findHeaderFacts } from "../db/header-facts";
import { getClerkKeys, getDb } from "../runtime-env";

export type HeaderState = {
  isAdmin: boolean;
  username: string | null;
  avatarUrl: string | null;
  unread: number;
};

const nobody: HeaderState = {
  isAdmin: false,
  username: null,
  avatarUrl: null,
  unread: 0,
};

/**
 * What the header shows about the person of the session (SAG-114): the link to the administration
 * for an administrator (SAG-95), the link to their profile and the count of unread notifications
 * (SAG-102). One small read for a person with a session, and nothing for a visitor. It is a
 * convenience and not a check: the server still refuses every page of the administration to anyone
 * who is not an administrator with a verified Google login (`requireRole('admin')`).
 *
 * A failure of the database says nobody and is logged by name: a link or a number that is missing
 * for a moment must not break every page.
 */
export async function getHeaderState(
  args: LoaderFunctionArgs,
): Promise<HeaderState> {
  if (!getClerkKeys()) return nobody;
  const { userId } = await getAuth(args);
  if (!userId) return nobody;
  try {
    return (await findHeaderFacts(await getDb(), userId)) ?? nobody;
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "nav.header_facts_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return nobody;
  }
}
