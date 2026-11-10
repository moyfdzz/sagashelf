import { data, redirect, redirectDocument } from "react-router";

import type { Route } from "./+types/library.add-external";
import { getLocale } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { addEntry } from "~server/db/library";
import { findMediaByExternalId } from "~server/db/media-detail";
import { externalTitleSchema } from "~server/library/schema";
import { importMedia } from "~server/media/import";
import { mediaPath } from "~server/media/slug";
import { ProviderError } from "~server/providers/http";
import { rateLimit } from "~server/rate-limit";
import { readForm } from "~server/http/body";
import { searchBackPath } from "~server/search/path";
import {
  getDb,
  getMediaProviders,
  getOpenLimiter,
  getWriteLimiter,
} from "~server/runtime-env";
import { privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has a provider and an id. Anything bigger is not from the search.
const maxFormBytes = 1024;

// Each code is the same text on the page: the title could not be added.
type ErrorCode = "invalid_request" | "not_found" | "unavailable";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

/**
 * A form that the search sends with JavaScript is a `fetch`, and its answer is data: the result
 * changes in place. The same form without JavaScript is a document, and the person goes to their
 * entry. `Sec-Fetch-Dest` says which, and only the first is `empty`.
 */
const asksForData = (request: Request) =>
  request.headers.get("Sec-Fetch-Dest") === "empty";

// Only the button of a search result adds a title this way, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

/**
 * Adds to the library of the signed-in person a title that the search found, and that may not be
 * in our database yet: it is saved first, the same way `/media/open` does it, and then added as
 * "planned". Adding it is the person asking for it, so this is a title being opened and not a
 * search saving things (ADR-004). A title we already hold costs no call to the provider. The
 * person is the one in the verified session, never a field of the form.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to fill someone's library.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("invalid_request", 413)
      : fail("invalid_request", 403);
  }

  const user = await getOptionalUser(args);
  if (!user) {
    return redirectDocument(
      signInPath(request.headers.get("Referer") ?? request.url),
      303,
    );
  }

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `library:${user.id}`,
  );
  if (limited) return limited;

  const parsed = externalTitleSchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  if (!parsed.success) return fail("invalid_request", 400);

  // Without JavaScript a refusal sends the person back to their search, which is not lost.
  const refuse = (error: ErrorCode, status: number) =>
    asksForData(request)
      ? fail(error, status)
      : redirect(
          searchBackPath(
            request.headers.get("Referer"),
            new URL(request.url).origin,
          ) ?? "/search",
          { status: 303, headers: privateHeaders },
        );

  const db = await getDb();
  let title = await findMediaByExternalId(
    db,
    parsed.data.provider,
    parsed.data.id,
  );
  if (!title) {
    // Only a call to the provider counts, against the same per-person limit as /media/open.
    const slowed = await rateLimit(
      getOpenLimiter(),
      request,
      `media-open:${user.id}`,
    );
    if (slowed) return slowed;

    try {
      title = await importMedia(
        { db, providers: getMediaProviders() },
        parsed.data.provider,
        parsed.data.id,
        getLocale(args.context) === "en" ? "en" : "es",
      );
    } catch (error) {
      if (error instanceof ProviderError) return refuse("unavailable", 502);
      throw error;
    }
    if (!title) return refuse("not_found", 404);
  }

  // A title that is not ours to add (one a person made for themselves) is the same as not found.
  if (!(await addEntry(db, user.id, title.id))) {
    return refuse("not_found", 404);
  }

  return asksForData(request)
    ? data(
        {
          ok: true as const,
          mediaId: title.id,
          // Where the title page is, so the result can link to it now that it is saved.
          href: mediaPath(title.type, title.title, title.id),
        },
        { headers: privateHeaders },
      )
    : redirect(`/library/${title.id}`, {
        status: 303,
        headers: privateHeaders,
      });
}
