import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/library.$mediaId.status";
import { requireUser } from "~server/auth/require";
import {
  getEntry,
  getSeasonCounts,
  saveEntry,
  totalEpisodes,
} from "~server/db/library";
import { returnPath } from "~server/library/back";
import { applyStatus } from "~server/library/rules";
import { libraryStatuses } from "~server/library/schema";
import { readForm } from "~server/http/body";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";

// The form has one short field. Anything bigger is not from the title page.
const maxFormBytes = 1024;

// Answers that carry a person's data are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

const mediaIdSchema = z.uuid();
const formSchema = z.strictObject({ status: z.enum(libraryStatuses) });

// Each code is the same text on the page: the change could not be saved.
type ErrorCode = "invalid_request" | "failed";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

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

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(request, fail("invalid_request", 413));
  }

  // A page on another site must not be able to change someone's library.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(request, fail("invalid_request", 403));
  }

  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `library:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const mediaId = mediaIdSchema.safeParse(args.params.mediaId);
  if (!mediaId.success) {
    return answerWithoutReading(request, fail("invalid_request", 404));
  }
  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);

  const db = await getDb();
  const current = await getEntry(db, user.id, mediaId.data, "es");
  // Somebody else's entry and no entry at all look the same.
  if (!current) return fail("invalid_request", 404);

  const result = applyStatus(current, parsed.data.status, {
    totalEpisodes: totalEpisodes(await getSeasonCounts(db, mediaId.data)),
    type: current.type,
    today: new Date().toISOString().slice(0, 10),
  });
  if (!result.ok) {
    return asksForDocument(request)
      ? redirect(`/library/${mediaId.data}`, { status: 303 })
      : fail("failed", 400);
  }

  if (!(await saveEntry(db, user.id, mediaId.data, result.next))) {
    return fail("invalid_request", 404);
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
