import { clerkMiddleware } from "@clerk/react-router/server";
import type { MiddlewareFunction } from "react-router";

import { getClerkKeys } from "~server/runtime-env";

/**
 * Verifies the session cookie on every request. With `jwtKey` a valid token needs no call to
 * Clerk. Without Clerk keys (previews and tests) the request goes on signed out, so the public
 * pages keep working; the guards then refuse protected routes.
 */
export const authMiddleware: MiddlewareFunction<Response> = (args, next) => {
  // Webhooks are server to server and carry a signature, not a session.
  if (new URL(args.request.url).pathname.startsWith("/webhooks/"))
    return next();

  const keys = getClerkKeys();
  if (!keys) return next();
  // A session token says which site it was made for (`azp`). Only this site is accepted, so a
  // token made on another subdomain of the domain is refused here.
  return clerkMiddleware({
    ...keys,
    authorizedParties: [new URL(args.request.url).origin],
  })(args, next);
};
