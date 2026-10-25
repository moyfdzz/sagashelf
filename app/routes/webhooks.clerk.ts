import { verifyWebhook } from "@clerk/backend/webhooks";

import type { Route } from "./+types/webhooks.clerk";
import { planClerkEvent } from "~server/auth/clerk-user";
import { readText } from "~server/http/body";
import { applyClerkOperation } from "~server/db/clerk-sync";
import { rateLimit } from "~server/rate-limit";
import {
  getClerkWebhookSecret,
  getDb,
  getWriteLimiter,
} from "~server/runtime-env";

// A Clerk user event is a few kilobytes. Anything this large is not from Clerk.
const maxBodyBytes = 64 * 1024;

// Answering before the body is read leaves it open, and the local runtime then fails the next
// request on the same connection. Read and drop it first (the size was already checked).
async function answerWithoutReading(request: Request, response: Response) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

/**
 * Clerk's user webhook (SAG-11). The order matters: the rate limit and the size limit come
 * first, the signature is checked before the body is parsed or the database is opened, and
 * the event id that goes into `processed_webhooks` is the verified `svix-id`. A forged request
 * never reaches the database. Answers are short and say nothing about why a request failed.
 */
export async function action({ request }: Route.ActionArgs) {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBodyBytes) {
    return answerWithoutReading(
      request,
      Response.json({ error: "payload_too_large" }, { status: 413 }),
    );
  }

  const limited = await rateLimit(getWriteLimiter(), request, "webhook-clerk");
  if (limited) return answerWithoutReading(request, limited);

  const secret = getClerkWebhookSecret();
  if (!secret) {
    // A 503 alone leaves no trace, and this is the first thing to check when Clerk reports
    // failed deliveries: the secret may be missing from this deployment.
    console.warn(
      "clerk webhook: CLERK_WEBHOOK_SIGNING_SECRET is not set in this deployment",
    );
    return answerWithoutReading(
      request,
      Response.json({ error: "not_configured" }, { status: 503 }),
    );
  }

  // The header can be left out, so the bytes that arrive are counted too.
  let body: string;
  try {
    body = await readText(request, maxBodyBytes);
  } catch {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  let event;
  try {
    // The body was read once above, so give the verifier a request that carries it again.
    event = await verifyWebhook(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      }),
      { signingSecret: secret },
    );
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const eventId = request.headers.get("svix-id")?.trim() ?? "";
  const operation = planClerkEvent(event);
  if (operation.kind === "ignore") {
    return Response.json({ status: "ignored" });
  }

  try {
    const status = await applyClerkOperation(await getDb(), eventId, operation);
    return Response.json({ status });
  } catch (error) {
    // Svix retries on a 5xx. Only the event id, its type and the kind of error are logged:
    // never the body, an email address or a token.
    console.error("clerk webhook failed", {
      eventId,
      type: event.type,
      error: error instanceof Error ? error.name : "unknown",
    });
    return Response.json({ error: "try_again" }, { status: 500 });
  }
}

// Only Clerk's servers call this URL, with POST.
export function loader() {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
