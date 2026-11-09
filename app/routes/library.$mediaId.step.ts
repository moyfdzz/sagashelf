import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/library.$mediaId.step";
import { requireUser } from "~server/auth/require";
import { returnPath } from "~server/library/back";
import { applyStep } from "~server/library/rules";
import { lazyTotalEpisodes, updateEntry } from "~server/library/update-entry";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";
import { privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has no fields. Anything bigger is not from the library page.
const maxFormBytes = 1024;

const mediaIdSchema = z.uuid();

// Each code is the same text on the page: a step that could not be saved. `too_high` is a title
// that was already at its end.
type ErrorCode = "too_high" | "invalid_request" | "failed";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

/**
 * A browser that submits a form without JavaScript asks for a document and would show the JSON
 * of the answer. `Sec-Fetch-Dest` says so, and the person goes back to the library instead.
 */
const asksForDocument = (request: Request) =>
  request.headers.get("Sec-Fetch-Dest") === "document";

// Only the "+1" of the library page steps an entry, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

/**
 * Adds one episode, page, chapter or volume to the entry of the signed-in person, with the rules
 * of the editor (`applyStep`). The person is the one in the verified session, never a field of the
 * form. Every refusal is an answer with data and not an error thrown to the page, so the button
 * that sent it can put the number back and say so.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to change someone's progress.
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
  // The form has nothing to read; the body is read and dropped.
  await request.arrayBuffer().catch(() => undefined);

  const db = await getDb();
  const episodes = lazyTotalEpisodes(db, mediaId.data);
  const today = new Date().toISOString().slice(0, 10);
  // The step is worked out on what the entry is when it is written, not on an older read.
  const result = await updateEntry(db, user.id, mediaId.data, async (current) =>
    applyStep(current, {
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
    if (result.outcome === "conflict") return fail("failed", 409);
    return fail(
      result.error === "progress_too_high" ? "too_high" : "failed",
      400,
    );
  }

  // Without JavaScript the person goes back to the library or the title page they were on.
  return asksForDocument(request)
    ? redirect(
        returnPath(
          request.headers.get("Referer"),
          new URL(request.url).origin,
          "/library",
        ),
        { status: 303, headers: privateHeaders },
      )
    : data(
        {
          ok: true as const,
          progress: result.next.progress,
          status: result.next.status,
        },
        { headers: privateHeaders },
      );
}
