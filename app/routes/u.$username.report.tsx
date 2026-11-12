import { useTranslation } from "react-i18next";
import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/u.$username.report";
import { BackLink } from "~/components/BackLink";
import { dangerButtonClass, inputClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import {
  canCancelReport,
  isReportKind,
  maxReportDetails,
  reasonsOf,
  reportFormSchema,
  type ReportReason,
} from "~server/account/report-schema";
import { usernameShape } from "~server/account/profile-schema";
import { requireUser } from "~server/auth/require";
import { findProfile } from "~server/db/profile-lookup";
import { cancelReport, createReport, findMyReports } from "~server/db/reports";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { rateLimit } from "~server/rate-limit";
import { getDb, getWriteLimiter } from "~server/runtime-env";

// A short reason, and the rest of the form.
const maxFormBytes = 8 * 1024;

// The same answer as the profile itself: this says nothing about who exists (ADR-031).
const notFound = () => data(null, { status: 404, headers: privateHeaders });

const httpsOnly = (url: string | null) =>
  url?.startsWith("https://") ? url : null;

/**
 * Whom a person may report: somebody else whose card they may see. A profile that may not be seen,
 * such as Total privacy or a block, answers like one that does not exist.
 */
async function reportable(
  db: Awaited<ReturnType<typeof getDb>>,
  viewerId: string,
  username: string,
) {
  const found = await findProfile(db, viewerId, username);
  return found && found.relationship !== "owner" ? found.owner : null;
}

/** The picture that can be reported: a person's own, and never the image Clerk generates. */
const ownPicture = (owner: {
  avatarUrl: string | null;
  hasOwnPicture: boolean;
}) => (owner.hasOwnPicture ? httpsOnly(owner.avatarUrl) : null);

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  if (!usernameShape.test(params.username)) throw notFound();
  const kind = new URL(request.url).searchParams.get("target");
  if (!isReportKind(kind)) throw notFound();

  const user = await requireUser(args);
  const db = await getDb();
  const owner = await reportable(db, user.id, params.username);
  if (!owner) throw notFound();
  const pictureUrl = ownPicture(owner);
  if (kind === "picture" && !pictureUrl) throw notFound();

  const mine = await findMyReports(db, user.id, owner.id, pictureUrl);
  const existing = mine[kind];
  const { t } = getInstance(context);
  const name = owner.displayName ?? owner.username;
  return {
    title: t("app.pageTitle", {
      title: t(`report.title.${kind}`, { name }),
    }),
    kind,
    name,
    username: owner.username,
    reasons: reasonsOf(kind),
    existing: existing
      ? {
          id: existing.id,
          // The reasons of older reports have no text, so they are shown only when they do.
          reason: reasonsOf(kind).includes(existing.reason as ReportReason)
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
  const back = `/u/${encodeURIComponent(params.username)}`;

  // A page on another site must not be able to report somebody in someone's name.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return data(
      { error: "invalid_request" as const },
      { status: unsafe === "too_large" ? 413 : 403, headers: privateHeaders },
    );
  }
  if (!usernameShape.test(params.username)) throw notFound();

  // The reporter is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `report:${user.id}`,
  );
  if (limited) return limited;

  const parsed = reportFormSchema.safeParse(
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
      `${back}?notice=${cancelled ? "report_cancelled" : "unavailable"}`,
      303,
    );
  }

  const owner = await reportable(db, user.id, params.username);
  if (!owner) throw notFound();
  // The picture is the one the server has now, never an address sent by the form.
  const pictureUrl = form.kind === "picture" ? ownPicture(owner) : null;
  if (form.kind === "picture" && !pictureUrl) throw notFound();

  const outcome = await createReport(db, {
    reporterId: user.id,
    targetId: owner.id,
    kind: form.kind,
    reason: form.reason as ReportReason,
    details: form.details || null,
    pictureUrl,
  });
  return redirect(`${back}?notice=report_${outcome}`, 303);
}

export default function Report({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { kind, name, username, reasons, existing } = loaderData;
  const back = `/u/${encodeURIComponent(username)}`;
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold break-words">
        {t(`report.title.${kind}`, { name })}
      </h1>
      <p className="mt-2">
        <BackLink to={back}>{t("report.back", { name })}</BackLink>
      </p>

      {existing ? (
        <section className="mt-6 space-y-3">
          <p className="font-semibold">{t(`report.already.${kind}`)}</p>
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
          <input type="hidden" name="kind" value={kind} />
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
          {kind === "picture" ? (
            <p className="border-danger-edge bg-danger-bg text-danger-fg rounded-md border px-4 py-3 text-sm">
              {t("report.minorsWarning")}
            </p>
          ) : null}
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
              {t("report.detailsHint", { max: maxReportDetails })}
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
