import { data, type LoaderFunctionArgs } from "react-router";

import type { SessionUser } from "./authorize";
import { requireRole } from "./require";
import { drainBody, readForm } from "../http/body";
import { rateLimit } from "../rate-limit";
import { getWriteLimiter } from "../runtime-env";

/**
 * The checks every write of the administration has in common (SAG-92), in the order that does not
 * leave a body half read: the size from the header, the `Origin`, the role (an administrator with a
 * verified Google login, taken from the session and never from the form), the rate limit keyed by
 * the person, and then the form with its own limit. A refusal drains the body first, because an
 * answer given before the body is read breaks the connection under Miniflare.
 */
export async function readAdminWrite(
  args: LoaderFunctionArgs,
  scope: string,
  maxBytes: number,
): Promise<{ user: SessionUser; form: Record<string, FormDataEntryValue> }> {
  const { request } = args;
  const refuse = async (error: string, status: number): Promise<never> => {
    await drainBody(request);
    throw data({ error }, { status, headers: privateHeaders });
  };

  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) {
    return refuse("payload_too_large", 413);
  }
  // A page on another site must not be able to change a saga.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return refuse("forbidden", 403);
  }

  const user = await requireRole(args, "admin");

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `admin:${scope}:${user.id}`,
  );
  if (limited) {
    await drainBody(request);
    throw limited;
  }

  return { user, form: await readForm(request, maxBytes) };
}

// Answers of the administration are never kept by a shared cache.
export const privateHeaders = { "Cache-Control": "private, no-store" };
