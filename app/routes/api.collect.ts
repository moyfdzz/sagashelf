import type { Route } from "./+types/api.collect";
import { collectEventSchema, maxCollectBytes } from "~server/analytics/event";
import { isMeasured } from "~server/analytics/measure";
import { recordEvent } from "~server/analytics/record";
import { drainBody, readText } from "~server/http/body";
import { privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { rateLimit } from "~server/rate-limit";
import { getCollectLimiter, getDb } from "~server/runtime-env";

const empty = (status: number) =>
  new Response(null, { status, headers: privateHeaders });

/**
 * The collector of the cookieless analytics (SAG-24, ADR-009, ADR-050). The tracker sends one event
 * with `sendBeacon`, which ignores the answer, so every answer is empty. The checks come first and
 * in this order: the size and the `Origin`, the rate limit, a visitor who asked not to be measured or
 * a robot (answered as if it had been counted, and nothing is kept), and then the event.
 */
export async function action({ request }: Route.ActionArgs) {
  // The framework runs an action for PUT, PATCH and DELETE too; only a beacon, which is a POST, counts.
  if (request.method !== "POST") {
    await drainBody(request);
    return new Response(null, {
      status: 405,
      headers: { ...privateHeaders, Allow: "POST" },
    });
  }

  // A page on another site must not be able to fill the numbers of this one.
  const unsafe = checkWrite(request, maxCollectBytes);
  if (unsafe) {
    await drainBody(request);
    return empty(unsafe === "too_large" ? 413 : 403);
  }

  const limited = await rateLimit(getCollectLimiter(), request, "collect");
  if (limited) {
    await drainBody(request);
    return limited;
  }

  // Where the analytics are off, or for a visitor who asked not to be measured, a robot or a call
  // that did not come through the edge, nothing is kept (see `isMeasured`).
  if (!isMeasured(request)) {
    await drainBody(request);
    return empty(204);
  }

  // A body bigger than the limit is the 413 that `readText` throws.
  const text = await readText(request, maxCollectBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return empty(400);
  }
  const event = collectEventSchema.safeParse(body);
  if (!event.success) return empty(400);

  await recordEvent(await getDb(), request, event.data, new Date());
  return empty(204);
}

// Opening this URL directly records nothing.
export function loader() {
  return new Response(null, {
    status: 405,
    headers: { ...privateHeaders, Allow: "POST" },
  });
}
