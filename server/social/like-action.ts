import { data, redirect, type ActionFunctionArgs } from "react-router";
import { z } from "zod";

import { requireUser } from "../auth/require";
import { setLike } from "../db/feed";
import { readForm } from "../http/body";
import { privateHeaders } from "../http/cache";
import { checkWrite } from "../http/write-guard";
import { rateLimit } from "../rate-limit";
import { getDb, getWriteLimiter } from "../runtime-env";

// The form has an id and a yes or no. Anything bigger is not from a like button.
const maxFormBytes = 256;

const likeSchema = z.strictObject({
  activityId: z.uuid(),
  liked: z.enum(["true", "false"]),
});

// Each code has its text in app/locales, under feed.errors.
type ErrorCode = "invalid_request" | "not_found" | "rate_limited";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

/**
 * Likes an event or takes the like back (SAG-22, ADR-055 and ADR-056), as the person of the session:
 * the action of the feed and of a title page, which are the two places with a like button. A form
 * sent without JavaScript goes back to `back(request)`, the page it came from.
 */
export async function likeAction(
  args: ActionFunctionArgs,
  back: (request: Request) => string,
) {
  const { request } = args;

  // A page on another site must not be able to like for someone.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return fail("invalid_request", unsafe === "too_large" ? 413 : 403);
  }

  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `like:${user.id}`,
  );
  // The page says why the like did not stay, so the refusal is an answer like the others.
  if (limited) return fail("rate_limited", 429);

  const parsed = likeSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);

  const liked = parsed.data.liked === "true";
  const result = await setLike(
    await getDb(),
    user.id,
    parsed.data.activityId,
    liked,
  );

  if (request.headers.get("Sec-Fetch-Dest") === "document") {
    return redirect(back(request), { status: 303, headers: privateHeaders });
  }
  // An event that is gone, hidden or the person's own all answer the same. Taking a like back
  // always answers: the like is gone, and the count of a hidden event stays unknown (null).
  if (!result) return fail("not_found", 404);
  return data(
    { ok: true as const, liked, likes: result.likes },
    { headers: privateHeaders },
  );
}
