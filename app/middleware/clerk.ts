import { clerkMiddleware } from "@clerk/react-router/server";
import type { MiddlewareFunction } from "react-router";

import { getClerkKeys } from "~server/runtime-env";

/**
 * Verifies the session cookie on every request. With `jwtKey` a valid token needs no call to
 * Clerk. Without Clerk keys (previews and tests) the request goes on signed out, so the public
 * pages keep working; the guards then refuse protected routes.
 */
export const authMiddleware: MiddlewareFunction<Response> = (args, next) => {
  const keys = getClerkKeys();
  if (!keys) return next();
  return clerkMiddleware(keys)(args, next);
};
