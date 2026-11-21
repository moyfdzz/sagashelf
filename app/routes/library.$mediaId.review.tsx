import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/library.$mediaId.review";
import { BackLink } from "~/components/BackLink";
import { ClerkSession } from "~/components/ClerkSession";
import { ReviewForm } from "~/components/reviews/ReviewForm";
import { linkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { getEntry, saveEntry } from "~server/db/library";
import {
  deleteReview,
  getOwnReview,
  getReviewerFacts,
  isReviewable,
  saveReview,
} from "~server/db/reviews";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { visibilityLevels } from "~server/library/schema";
import { mediaPath } from "~server/media/slug";
import { rateLimit } from "~server/rate-limit";
import {
  bodyProblem,
  normalizeReviewBody,
  reviewFingerprint,
} from "~server/reviews/rules";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";

// 5000 characters of up to 4 bytes, sent as a form (each byte can take 3), and a few short fields.
const maxFormBytes = 64 * 1024;

const mediaIdSchema = z.uuid();

const formSchema = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("save"),
    body: z.string().max(25_000),
    spoiler: z.literal("on").optional(),
    visibility: z.enum(visibilityLevels),
    score: z
      .string()
      .regex(/^(?:10|[1-9])?$/)
      .transform((value) => (value === "" ? null : Number(value))),
  }),
  z.strictObject({ intent: z.literal("delete") }),
]);

/** Each code has its text in app/locales, under reviews.errors. */
export type ReviewError =
  | "invalid"
  | "too_short"
  | "too_long"
  | "link"
  | "duplicate"
  | "rate_limited"
  | "not_started"
  | "removed"
  | "conflict"
  | "score_conflict";

/** What the person sent, so a refused review is not lost: the page draws the form with it again. */
export type SentReview = {
  body: string;
  spoiler: boolean;
  visibility: (typeof visibilityLevels)[number];
  score: number | null;
};

const fail = (error: ReviewError, status: number, sent?: SentReview) =>
  data(
    { ok: false as const, error, sent: sent ?? null },
    { status, headers: privateHeaders },
  );

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const mediaId = mediaIdSchema.safeParse(args.params.mediaId);
  if (!mediaId.success) throw data(null, { status: 404 });

  const db = await getDb();
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  const entry = await getEntry(db, user.id, mediaId.data, locale);
  // Somebody else's entry and no entry at all look the same.
  if (!entry) throw data(null, { status: 404 });
  const [review, facts] = await Promise.all([
    getOwnReview(db, user.id, mediaId.data),
    getReviewerFacts(db, user.id),
  ]);

  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", {
      title: t("reviews.form.pageTitle", { title: entry.title }),
    }),
    publishableKey: keys.publishableKey,
    media: {
      id: entry.mediaId,
      title: entry.title,
      path: mediaPath(
        entry.type as Parameters<typeof mediaPath>[0],
        entry.title,
        entry.mediaId,
      ),
    },
    // A review needs a started title; one already written stays editable (ADR-053), unless a
    // moderator removed it: then the page says so and offers only to delete it (ADR-057).
    canWrite: review !== null || isReviewable(entry.status),
    entry: { score: entry.score, visibility: entry.visibility },
    review,
    // A new review starts at the level of the profile (ADR-053).
    defaultVisibility: review?.visibility ?? facts.privacy,
    privateProfile: facts.privacy === "private",
    held: facts.held,
  }));
}

export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/**
 * Saves or deletes the review of the person of the session (SAG-22, ADR-053). A saved review goes
 * back to the reviews of the title page; the score is the one of the library entry, written with
 * the same rules as the editor of the entry.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to write a review for someone.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) return fail("invalid", unsafe === "too_large" ? 413 : 403);

  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `review:${user.id}`,
  );
  if (limited) return fail("rate_limited", 429);

  const mediaId = mediaIdSchema.safeParse(args.params.mediaId);
  if (!mediaId.success) throw data(null, { status: 404 });

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid", 400);

  const db = await getDb();
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  const entry = await getEntry(db, user.id, mediaId.data, locale);
  if (!entry) throw data(null, { status: 404 });
  const back = `${mediaPath(
    entry.type as Parameters<typeof mediaPath>[0],
    entry.title,
    entry.mediaId,
  )}#reviews`;

  if (parsed.data.intent === "delete") {
    await deleteReview(db, user.id, mediaId.data);
    return redirect(back, { status: 303, headers: privateHeaders });
  }

  const form = parsed.data;
  const body = normalizeReviewBody(form.body);
  const sent: SentReview = {
    body,
    spoiler: form.spoiler === "on",
    visibility: form.visibility,
    score: form.score,
  };
  const problem = bodyProblem(body);
  if (problem) return fail(problem, 400, sent);

  const saved = await saveReview(
    db,
    user.id,
    mediaId.data,
    {
      body,
      fingerprint: await reviewFingerprint(body),
      spoiler: sent.spoiler,
      visibility: sent.visibility,
    },
    crypto.randomUUID(),
  );
  if (saved !== "created" && saved !== "updated") {
    return fail(saved, saved === "conflict" ? 409 : 400, sent);
  }

  // The score is the one of the entry (ADR-053): written only when it changed, and only if the
  // entry is as it was read, like every other change of the entry.
  if (form.score !== entry.score) {
    const scored = await saveEntry(
      db,
      user.id,
      mediaId.data,
      { ...entry, score: form.score },
      entry,
    );
    if (scored !== "saved") return fail("score_conflict", 409);
  }
  return redirect(back, { status: 303, headers: privateHeaders });
}

export type ReviewPageData = Route.ComponentProps["loaderData"];

export default function ReviewPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { media } = loaderData;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-10">
        <p className="mb-6">
          {/* A plain link: the title page is not a session page (ADR-018). */}
          <BackLink to={`${media.path}#reviews`}>
            {t("reviews.form.back")}
          </BackLink>
        </p>
        <h1 className="text-3xl font-bold">
          {loaderData.review
            ? t("reviews.form.editHeading", { title: media.title })
            : t("reviews.form.heading", { title: media.title })}
        </h1>
        {loaderData.canWrite ? (
          <ReviewForm
            data={loaderData}
            error={actionData?.ok === false ? actionData.error : null}
            sent={actionData?.ok === false ? actionData.sent : null}
          />
        ) : (
          <>
            <p className="mt-4">{t("reviews.startFirst")}</p>
            <p className="mt-2">
              <a href={`/library/${media.id}`} className={linkClass}>
                {t("reviews.form.toEntry")}
              </a>
            </p>
          </>
        )}
      </main>
    </ClerkSession>
  );
}
