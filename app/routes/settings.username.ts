import { createClerkClient } from "@clerk/backend";
import { data } from "react-router";

import type { Route } from "./+types/settings.username";
import { usernameChangeSchema } from "~server/account/username-schema";
import { requireUser } from "~server/auth/require";
import { getProfile } from "~server/db/profile";
import {
  applyUsername,
  claimUsernameChange,
  isUsernameTaken,
  releaseUsernameChange,
} from "~server/db/username";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";

// The form has one short name. Anything bigger is not from this page.
const maxFormBytes = 1024;

// Pages and answers that carry a person's data are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

// Each code has its text in app/locales, under settings.username.errors. A name that is taken,
// reserved or refused by Clerk all answer "unavailable", so the answer does not say which.
type ErrorCode =
  "invalid" | "unavailable" | "cooldown" | "failed" | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

// Only the form of the settings page changes the username, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(request, fail("invalid_request", 413));
  }

  // A page on another site must not be able to change someone's username.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(request, fail("invalid_request", 403));
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `username:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

  const parsed = usernameChangeSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!parsed.success) {
    const reserved = parsed.error.issues.some(
      (issue) => issue.message === "username_reserved",
    );
    return reserved ? fail("unavailable", 409) : fail("invalid", 400);
  }
  const { username } = parsed.data;

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) throw data({ error: "forbidden" }, { status: 403 });
  // The name the person already has is not a change and does not use up the 30 days.
  if (profile.username === username) {
    return data({ ok: true as const, username }, { headers: privateHeaders });
  }

  // Our own table first: it holds every name in use, deleted accounts included.
  if (await isUsernameTaken(db, user.id, username)) {
    return fail("unavailable", 409);
  }

  const claim = await claimUsernameChange(db, user.id);
  if (!claim.ok) {
    if (claim.reason === "gone")
      throw data({ error: "forbidden" }, { status: 403 });
    return fail("cooldown", 429);
  }

  // Clerk owns the username. If it refuses, the change is given back and nothing was changed.
  let clerkUpdatedAt: Date;
  try {
    const updated = await createClerkClient({
      secretKey: keys.secretKey,
      publishableKey: keys.publishableKey,
    }).users.updateUser(user.clerkId, { username });
    clerkUpdatedAt = new Date(updated.updatedAt);
  } catch (error) {
    await releaseUsernameChange(db, user.id, claim.previous);
    // 422 is Clerk saying the name is not valid or is in use.
    const refused = (error as { status?: number }).status === 422;
    console.error("username change: Clerk refused", (error as Error).name);
    return refused ? fail("unavailable", 409) : fail("failed", 502);
  }

  // Our row follows now, with Clerk's time, so a late `user.updated` cannot undo it. If this
  // write fails, that same event writes the name a moment later.
  try {
    await applyUsername(db, user.id, username, clerkUpdatedAt);
  } catch (error) {
    console.error("username change: local write failed", (error as Error).name);
  }

  return data({ ok: true as const, username }, { headers: privateHeaders });
}
