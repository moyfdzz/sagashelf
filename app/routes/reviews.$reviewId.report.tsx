import { useTranslation } from "react-i18next";
import { data, Form, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/reviews.$reviewId.report";
import { BackLink } from "~/components/BackLink";
import { StatusRegion } from "~/components/StatusRegion";
import { dangerButtonClass, inputClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import {
  canCancelReport,
  maxReportDetails,
  reasonsOf,
  reviewReportFormSchema,
  type ReportReason,
} from "~server/account/report-schema";
import { requireUser } from "~server/auth/require";
import { cancelReport, createReport } from "~server/db/reports";
import {
  findMyReviewReport,
  findReportableReview,
} from "~server/db/review-reports";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { isMediaKind, mediaPath } from "~server/media/slug";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";

// A short reason, and the rest of the form.
const maxFormBytes = 8 * 1024;

const reviewIdSchema = z.uuid();

// A review that does not exist and one the person may not see answer the same (ADR-031).
const notFound = () => data(null, { status: 404, headers: privateHeaders });

/** What the page says after sending or cancelling. Anything else in the address is ignored. */
const notices = [
  "reported",
  "duplicate",
  "limit",
  "cancelled",
  "unavailable",
] as const;
type Notice = (typeof notices)[number];
const asNotice = (value: string | null): Notice | null =>
  notices.find((notice) => notice === value) ?? null;

/**
 * Reports a review (SAG-22, ADR-057): one the title page shows the person, and not their own. The
 * report keeps the author and the review, so a moderator can act on the author even after the
 * review is deleted.
 */
export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  const reviewId = reviewIdSchema.safeParse(params.reviewId);
  if (!reviewId.success) throw notFound();

  const user = await requireUser(args);
  const db = await getDb();
  const [review, existing] = await Promise.all([
    findReportableReview(db, user.id, reviewId.data),
    findMyReviewReport(db, user.id, reviewId.data),
  ]);
  if (!review || !isMediaKind(review.media.type)) throw notFound();

  const { t } = getInstance(context);
  const name = review.author.displayName ?? review.author.username;
  return {
    title: t("app.pageTitle", { title: t("report.title.review", { name }) }),
    name,
    mediaTitle: review.media.title,
    back: `${mediaPath(review.media.type, review.media.title, review.media.id)}#reviews`,
    reasons: reasonsOf("review"),
    notice: asNotice(new URL(request.url).searchParams.get("notice")),
    existing: existing
      ? {
          id: existing.id,
          reason: reasonsOf("review").includes(existing.reason as ReportReason)
            ? (existing.reason as ReportReason)
            : null,
          canCancel: canCancelReport(existing),
        }
      : null,
  };
}

export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request, params } = args;

  // A page on another site must not be able to report a review in someone's name.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return data(
      { error: "invalid_request" as const },
      { status: unsafe === "too_large" ? 413 : 403, headers: privateHeaders },
    );
  }
  const reviewId = reviewIdSchema.safeParse(params.reviewId);
  if (!reviewId.success) throw notFound();
  const here = `/reviews/${reviewId.data}/report`;

  // The reporter is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `report:${user.id}`,
  );
  if (limited) return limited;

  const parsed = reviewReportFormSchema.safeParse(
    await readForm(request, maxFormBytes),
  );
  if (!parsed.success) {
    const needsDetails = parsed.error.issues.some(
      (issue) => issue.message === "details_required",
    );
    return data(
      {
        error: needsDetails
          ? ("details_required" as const)
          : ("invalid_request" as const),
      },
      { status: 400, headers: privateHeaders },
    );
  }
  const form = parsed.data;
  const db = await getDb();

  if (form.intent === "cancel") {
    const cancelled = await cancelReport(db, user.id, form.id);
    return redirect(
      `${here}?notice=${cancelled ? "cancelled" : "unavailable"}`,
      303,
    );
  }

  // The author is the one the server reads now, never an id sent by the form.
  const review = await findReportableReview(db, user.id, reviewId.data);
  if (!review) throw notFound();

  const outcome = await createReport(db, {
    reporterId: user.id,
    targetId: review.authorId,
    kind: "review",
    reason: form.reason as ReportReason,
    details: form.details || null,
    pictureUrl: null,
    reviewId: review.id,
  });
  return redirect(`${here}?notice=${outcome}`, 303);
}

export default function ReportReview({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { name, mediaTitle, back, reasons, existing, notice } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold break-words">
        {t("report.title.review", { name })}
      </h1>
      <p className="mt-2">
        <BackLink to={back}>
          {t("report.backToTitle", { title: mediaTitle })}
        </BackLink>
      </p>
      <StatusRegion
        message={notice ? t(`report.reviewNotices.${notice}`) : null}
      />

      {existing ? (
        <section className="mt-6 space-y-3">
          <p className="font-semibold">{t("report.already.review")}</p>
          {existing.reason ? (
            <p>
              {t("report.yourReason", {
                reason: t(`report.reasons.${existing.reason}`),
              })}
            </p>
          ) : null}
          {existing.canCancel ? (
            <>
              <p className="text-fg-muted text-sm">{t("report.cancelHint")}</p>
              <Form method="post" reloadDocument>
                <input type="hidden" name="intent" value="cancel" />
                <input type="hidden" name="id" value={existing.id} />
                <button type="submit" className={dangerButtonClass}>
                  {t("report.cancel")}
                </button>
              </Form>
            </>
          ) : (
            <p className="text-fg-muted text-sm">{t("report.cannotCancel")}</p>
          )}
        </section>
      ) : (
        <Form method="post" reloadDocument className="mt-6 space-y-6">
          <input type="hidden" name="intent" value="report" />
          <input type="hidden" name="kind" value="review" />
          <p className="text-fg-muted text-sm">{t("report.anonymous")}</p>
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t("report.reasonLabel")}</legend>
            {reasons.map((reason) => (
              <label key={reason} className="flex min-h-10 items-center gap-2">
                <input
                  type="radio"
                  name="reason"
                  value={reason}
                  required
                  className="shrink-0"
                />
                {t(`report.reasons.${reason}`)}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="details" className="font-semibold">
              {t("report.detailsLabel")}
            </label>
            <textarea
              id="details"
              name="details"
              rows={4}
              maxLength={maxReportDetails}
              aria-describedby="details-hint"
              aria-invalid={error === "details_required" ? true : undefined}
              className={inputClass}
            />
            <p id="details-hint" className="text-fg-muted mt-1 text-sm">
              {t("report.reviewDetailsHint", { max: maxReportDetails })}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-danger-text text-sm font-semibold">
              {t(`report.errors.${error}`)}
            </p>
          ) : null}
          <button type="submit" className={primaryButtonClass}>
            {t("report.submit")}
          </button>
        </Form>
      )}
    </main>
  );
}
