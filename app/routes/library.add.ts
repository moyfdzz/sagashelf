import { data, redirect, redirectDocument } from "react-router";

import type { Route } from "./+types/library.add";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { addEntry } from "~server/db/library";
import { addEntrySchema } from "~server/library/schema";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";
import { readForm } from "~server/http/body";

// The form has one id. Anything bigger is not from the title page.
const maxFormBytes = 1024;

const privateHeaders = { "Cache-Control": "private, no-store" };

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

/** The page the form was sent from, when it is on this site, to bring the person back to it. */
function cameFrom(request: Request): string {
  const referer = request.headers.get("Referer");
  if (!referer) return request.url;
  try {
    const from = new URL(referer);
    return from.origin === new URL(request.url).origin
      ? from.href
      : request.url;
  } catch {
    return request.url;
  }
}

// Only the button of a title page adds a title, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

/**
 * Adds a title to the library of the signed-in person and takes them to their entry, where they
 * set the status and the progress. The person is the one in the verified session, never a field
 * of the form. A session that ran out between loading the page and pressing the button sends
 * them to sign in and then back to the title, so the press is lost but nothing is broken.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(
      request,
      data({ error: "payload_too_large" }, { status: 413 }),
    );
  }

  // A page on another site must not be able to fill someone's library.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(
      request,
      data({ error: "forbidden" }, { status: 403 }),
    );
  }

  const user = await getOptionalUser(args);
  if (!user) {
    return answerWithoutReading(
      request,
      redirectDocument(signInPath(cameFrom(request)), 303),
    );
  }

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `library:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const parsed = addEntrySchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  if (!parsed.success) {
    return data({ error: "invalid_request" }, { status: 400 });
  }

  const found = await addEntry(await getDb(), user.id, parsed.data.mediaId);
  if (!found) throw data({ error: "not_found" }, { status: 404 });

  // The entry page loads Clerk's script under its own security policy, which only a new
  // document gets, so this is a redirect to a whole page.
  return redirect(`/library/${parsed.data.mediaId}`, {
    status: 303,
    headers: privateHeaders,
  });
}
