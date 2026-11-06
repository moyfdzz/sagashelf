import { createClerkClient } from "@clerk/backend";
import { data } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings.avatar";
import { maxPictureBytes, pictureType } from "~server/account/picture-file";
import { requireUser } from "~server/auth/require";
import { applyAvatar, claimAvatarUpload } from "~server/db/avatar";
import { readForm } from "~server/http/body";
import { privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { moderatePicture } from "~server/moderation/sightengine";
import { rateLimit } from "~server/rate-limit";
import {
  getClerkKeys,
  getDb,
  getModerationKeys,
  getWriteLimiter,
} from "~server/runtime-env";

// The picture plus the few bytes of the form around it.
const maxFormBytes = maxPictureBytes + 4 * 1024;

const formSchema = z.strictObject({
  intent: z.enum(["upload", "remove"]),
  picture: z.instanceof(File).optional(),
});

// Each code has its text in app/locales, under settings.avatar.errors.
type ErrorCode =
  | "invalid_type"
  | "too_large"
  | "rejected"
  | "limit"
  | "unavailable"
  | "failed"
  | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

const saved = () =>
  data({ ok: true as const, savedAt: Date.now() }, { headers: privateHeaders });

// Only the form of the settings page changes the picture, with a POST.
export function loader() {
  throw data({ error: "method_not_allowed" }, { status: 405 });
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to change someone's picture.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("too_large", 413)
      : fail("invalid_request", 403);
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `avatar:${user.id}`,
  );
  if (limited) return limited;

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);
  const { intent, picture } = parsed.data;

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });
  const clerk = createClerkClient({
    secretKey: keys.secretKey,
    publishableKey: keys.publishableKey,
  });
  const db = await getDb();

  let changed: { imageUrl: string; updatedAt: number };
  if (intent === "remove") {
    try {
      changed = await clerk.users.deleteUserProfileImage(user.clerkId);
    } catch (error) {
      console.error("picture removal: Clerk refused", (error as Error).name);
      return fail("failed", 502);
    }
  } else {
    if (!picture) return fail("invalid_request", 400);
    if (picture.size > maxPictureBytes) return fail("too_large", 413);
    const bytes = new Uint8Array(await picture.arrayBuffer());
    // The real type, from the bytes. What the browser said about the file is not asked.
    const type = pictureType(bytes);
    if (!type) return fail("invalid_type", 400);

    // With no moderation there are no uploads: a picture is never published unchecked.
    const moderationKeys = getModerationKeys();
    if (!moderationKeys) return fail("unavailable", 503);

    const claim = await claimAvatarUpload(db, user.id);
    if (claim === "gone") throw data({ error: "forbidden" }, { status: 403 });
    if (claim === "limit") return fail("limit", 429);

    const answer = await moderatePicture(bytes, type, moderationKeys);
    if (answer === "rejected") return fail("rejected", 422);
    if (answer === "unavailable") return fail("unavailable", 503);

    try {
      changed = await clerk.users.updateUserProfileImage(user.clerkId, {
        file: new File([bytes], "picture", { type }),
      });
    } catch (error) {
      console.error("picture upload: Clerk refused", (error as Error).name);
      return fail("failed", 502);
    }
  }

  // Our row follows now, with Clerk's time. If this write fails, the `user.updated` event of Clerk
  // writes the address a moment later.
  try {
    await applyAvatar(
      db,
      user.id,
      changed.imageUrl.startsWith("https://") ? changed.imageUrl : null,
      new Date(changed.updatedAt),
    );
  } catch (error) {
    console.error("picture: local write failed", (error as Error).name);
  }
  return saved();
}
