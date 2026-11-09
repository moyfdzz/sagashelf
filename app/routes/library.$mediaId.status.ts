import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/library.$mediaId.status";
import { requireUser } from "~server/auth/require";
import { returnPath } from "~server/library/back";
import { applyStatus } from "~server/library/rules";
import { libraryStatuses } from "~server/library/schema";
import { lazyTotalEpisodes, updateEntry } from "~server/library/update-entry";
import { readForm } from "~server/http/body";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";
import { privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has one short field. Anything bigger is not from the title page.
const maxFormBytes = 1024;

const mediaIdSchema = z.uuid();
const formSchema = z.strictObject({ status: z.enum(libraryStatuses) });

// Each code is the same text on the page: the change could not be saved.
type ErrorCode = "invalid_request" | "failed";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

/**
 * A browser that submits a form without JavaScript asks for a document and would show the JSON
 * of the answer. `Sec-Fetch-Dest` says so, and the person goes back to the page they were on.
 */
const asksForDocument = (request: Request) =>
  request.headers.get("Sec-Fetch-Dest") === "document";

// Only the buttons of the title page change the status this way, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

/**
 * Changes the status of the entry of the signed-in person, with the rules of the editor
 * (`applyStatus`). The person is the one in the verified session, never a field of the form.
 * Every refusal is an answer with data and not an error thrown to the page, so the button that
 * sent it can put the old status back and say so.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to change someone's library.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("invalid_request", 413)
      : fail("invalid_request", 403);
  }

  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `library:${user.id}`,
  );
  if (limited) return limited;

  const mediaId = mediaIdSchema.safeParse(args.params.mediaId);
  if (!mediaId.success) {
    return fail("invalid_request", 404);
  }
  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);

  const db = await getDb();
  const episodes = lazyTotalEpisodes(db, mediaId.data);
  const today = new Date().toISOString().slice(0, 10);
  // The change is worked out on what the entry is when it is written, not on an older read.
  const result = await updateEntry(db, user.id, mediaId.data, async (current) =>
    applyStatus(current, parsed.data.status, {
      totalEpisodes: await episodes(),
      type: current.type,
      today,
    }),
  );
  // Somebody else's entry and no entry at all look the same.
  if (result.outcome === "missing") return fail("invalid_request", 404);
  if (result.outcome !== "saved") {
    // A form without JavaScript goes back to the entry, where the person sees how it is now.
    if (asksForDocument(request)) {
      return redirect(`/library/${mediaId.data}`, { status: 303 });
    }
    return fail("failed", result.outcome === "conflict" ? 409 : 400);
  }

  return asksForDocument(request)
    ? redirect(
        returnPath(
          request.headers.get("Referer"),
          new URL(request.url).origin,
          `/library/${mediaId.data}`,
        ),
        { status: 303, headers: privateHeaders },
      )
    : data(
        {
          ok: true as const,
          status: result.next.status,
          progress: result.next.progress,
        },
        { headers: privateHeaders },
      );
}
