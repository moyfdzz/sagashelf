import { getAuth } from "@clerk/react-router/server";
import type { LoaderFunctionArgs } from "react-router";

import { getClerkKeys } from "../runtime-env";

/**
 * Whether the request carries a valid session, for the header. It reads what the auth middleware
 * already verified, so it adds no call to Clerk and none to the database. Without Clerk keys the
 * middleware did not run and nobody is signed in.
 */
export async function isSignedIn(args: LoaderFunctionArgs): Promise<boolean> {
  if (!getClerkKeys()) return false;
  const { userId } = await getAuth(args);
  return Boolean(userId);
}
