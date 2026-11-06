import { createClerkClient } from "@clerk/backend";
import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/admin.moderation";
import { AdminNav } from "~/components/AdminNav";
import { ClerkSession } from "~/components/ClerkSession";
import { useFormatters } from "~/lib/format";
import {
  dangerButtonClass,
  linkClass,
  secondaryButtonClass,
  secondaryLinkClass,
} from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { isReportReason } from "~server/account/report-schema";
import { readAdminWrite } from "~server/auth/admin-write";
import { requireRole } from "~server/auth/require";
import {
  dismissReport,
  findPictureReport,
  listOpenReports,
  listSuspiciousUploads,
  recordPictureRemoved,
  restorePicture,
} from "~server/db/moderation";
import { privateRouteHeaders } from "~server/http/cache";
import {
  asModerationError,
  asModerationNotice,
  asReportId,
  maxModerationFormBytes,
  moderationActionSchema,
} from "~server/moderation/panel-schema";
import { getClerkKeys, getDb } from "~server/runtime-env";

const back = "/admin/moderation";

export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const params = new URL(args.request.url).searchParams;
  const view = asReportId(params.get("view"));
  const db = await getDb();
  const [reports, uploads] = await Promise.all([
    listOpenReports(db),
    listSuspiciousUploads(db),
  ]);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.moderation.title") }),
    publishableKey: keys.publishableKey,
    notice: asModerationNotice(params.get("notice")),
    error: asModerationError(params.get("error")),
    confirm: asReportId(params.get("confirm")),
    // A picture reported for minors is only sent when the reviewer asked for that one. The address
    // never reaches the browser otherwise, and only an https one is ever drawn.
    reports: reports.map((report) => ({
      ...report,
      createdAt: report.createdAt.getTime(),
      pictureUrl:
        report.pictureUrl?.startsWith("https://") &&
        (!report.sensitive || report.id === view)
          ? report.pictureUrl
          : null,
    })),
    uploads: uploads.map((upload) => ({
      ...upload,
      createdAt: upload.createdAt.getTime(),
    })),
  }));
}

/** Answers a report. Every answer is audited by the data function, with the administrator of the session. */
export async function action(args: Route.ActionArgs) {
  const { user, form } = await readAdminWrite(
    args,
    "moderation",
    maxModerationFormBytes,
  );
  const parsed = moderationActionSchema.safeParse(form);
  if (!parsed.success) {
    return redirect(`${back}?error=invalid_request`, { status: 303 });
  }
  const { intent, id } = parsed.data;
  const db = await getDb();
  const done = (ok: boolean, notice: string) =>
    redirect(`${back}?${ok ? `notice=${notice}` : "error=not_found"}`, {
      status: 303,
    });

  if (intent === "dismiss") {
    return done(await dismissReport(db, user.id, id), "dismissed");
  }
  if (intent === "restore") {
    return done(await restorePicture(db, user.id, id), "restored");
  }

  // Removing deletes the picture in Clerk, so it cannot come back with a later event. Only the
  // picture that was reported: a newer one is the person's and this report says nothing about it.
  const report = await findPictureReport(db, id);
  if (!report) return redirect(`${back}?error=not_found`, { status: 303 });
  if (!report.current) {
    return redirect(`${back}?error=outdated`, { status: 303 });
  }
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });
  const clerk = createClerkClient({
    secretKey: keys.secretKey,
    publishableKey: keys.publishableKey,
  });
  let changed: { imageUrl: string; hasImage: boolean; updatedAt: number };
  try {
    changed = await clerk.users.deleteUserProfileImage(report.clerkId);
  } catch (error) {
    console.error("moderation: Clerk refused", (error as Error).name);
    return redirect(`${back}?error=failed`, { status: 303 });
  }
  return done(
    await recordPictureRemoved(db, user.id, id, {
      avatarUrl: changed.imageUrl.startsWith("https://")
        ? changed.imageUrl
        : null,
      hasOwnPicture: changed.hasImage,
      updatedAt: new Date(changed.updatedAt),
    }),
    "removed",
  );
}

// A page with an administrator's work is never kept by a shared cache, and not indexed.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

type Item = Route.ComponentProps["loaderData"]["reports"][number];

function ActionButton({
  intent,
  id,
  className,
  children,
}: {
  intent: "dismiss" | "restore" | "remove";
  id: string;
  className: string;
  children: string;
}) {
  return (
    <Form method="post" reloadDocument>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={className}>
        {children}
      </button>
    </Form>
  );
}

function ReportCard({ report, confirm }: { report: Item; confirm: boolean }) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const isPicture = report.kind === "picture";
  // Only a picture that is still the person's can be judged, and a hidden one cannot be dismissed.
  const actionable = isPicture && report.current;

  return (
    <li className="border-border bg-surface-raised rounded-md border p-4">
      <p className="font-semibold break-words">
        <span className="text-fg-muted mr-2">
          {t(`admin.moderation.reports.kind.${report.kind}`)}
        </span>
        <a
          href={`/u/${encodeURIComponent(report.username)}`}
          className={linkClass}
        >
          {report.username}
        </a>
      </p>
      <p className="text-fg-muted mt-1 text-sm">
        <span className="font-semibold">
          {isReportReason(report.reason)
            ? t(`report.reasons.${report.reason}`)
            : t("admin.moderation.reports.unknownReason")}
        </span>
        <span className="ml-2">
          {formatDate(report.createdAt, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </p>
      {report.details ? (
        <p className="mt-2 break-words whitespace-pre-line">{report.details}</p>
      ) : null}

      {isPicture ? (
        <div className="mt-3">
          {report.hidden ? (
            <p className="text-sm font-semibold">
              {t("admin.moderation.reports.hidden")}
            </p>
          ) : null}
          {!report.current ? (
            <p className="text-fg-muted text-sm">
              {t("admin.moderation.reports.outdated")}
            </p>
          ) : report.pictureUrl ? (
            // The address comes from our own database and is https; it is drawn with no referrer.
            <img
              src={report.pictureUrl}
              alt={t("admin.moderation.reports.pictureAlt", {
                username: report.username,
              })}
              referrerPolicy="no-referrer"
              loading="lazy"
              width={160}
              height={160}
              className="mt-2 size-40 rounded-md object-cover"
            />
          ) : report.sensitive ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm">
                {t("admin.moderation.reports.sensitive")}
              </p>
              <a
                href={`${back}?view=${report.id}`}
                className={secondaryLinkClass}
              >
                {t("admin.moderation.reports.view")}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {confirm && actionable ? (
        <div
          role="alert"
          className="border-danger-edge bg-danger-bg text-danger-fg mt-4 space-y-3 rounded-md border p-4"
        >
          <p className="font-semibold break-words">
            {t("admin.moderation.reports.removeConfirm", {
              username: report.username,
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              intent="remove"
              id={report.id}
              className={dangerButtonClass}
            >
              {t("admin.moderation.reports.removeYes")}
            </ActionButton>
            <a href={back} className={secondaryLinkClass}>
              {t("admin.moderation.reports.removeNo")}
            </a>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          {report.hidden ? (
            <ActionButton
              intent="restore"
              id={report.id}
              className={secondaryButtonClass}
            >
              {t("admin.moderation.reports.restore")}
            </ActionButton>
          ) : (
            <ActionButton
              intent="dismiss"
              id={report.id}
              className={secondaryButtonClass}
            >
              {t("admin.moderation.reports.dismiss")}
            </ActionButton>
          )}
          {actionable ? (
            <a
              href={`${back}?confirm=${report.id}`}
              className={`${dangerButtonClass} inline-block`}
            >
              {t("admin.moderation.reports.remove")}
            </a>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function AdminModeration({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatDate, formatNumber } = useFormatters();

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <AdminNav current="moderation" />
        <h1 className="text-3xl font-bold">{t("admin.moderation.title")}</h1>
        <p className="text-fg-muted mt-2">
          {t("admin.moderation.description")}
        </p>

        {loaderData.notice ? (
          <p
            role="status"
            className="border-input-edge bg-surface mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`admin.moderation.notices.${loaderData.notice}`)}
          </p>
        ) : null}
        {loaderData.error ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`admin.moderation.errors.${loaderData.error}`)}
          </p>
        ) : null}

        <section aria-labelledby="moderation-reports" className="mt-8">
          <h2 id="moderation-reports" className="text-xl font-semibold">
            {t("admin.moderation.reports.title")}
          </h2>
          {loaderData.reports.length === 0 ? (
            <p className="text-fg-muted mt-2">
              {t("admin.moderation.reports.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {loaderData.reports.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  confirm={loaderData.confirm === report.id}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="moderation-uploads" className="mt-10">
          <h2 id="moderation-uploads" className="text-xl font-semibold">
            {t("admin.moderation.uploads.title")}
          </h2>
          <p className="text-fg-muted mt-1 text-sm">
            {t("admin.moderation.uploads.description")}
          </p>
          {loaderData.uploads.length === 0 ? (
            <p className="text-fg-muted mt-2">
              {t("admin.moderation.uploads.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {loaderData.uploads.map((upload) => (
                <li
                  key={upload.id}
                  className="border-border bg-surface-raised rounded-md border p-4"
                >
                  <p className="font-semibold break-words">
                    <a
                      href={`/u/${encodeURIComponent(upload.username)}`}
                      className={linkClass}
                    >
                      {upload.username}
                    </a>
                  </p>
                  <p className="text-fg-muted mt-1 text-sm">
                    <span className="font-semibold">
                      {t(`admin.moderation.uploads.result.${upload.result}`)}
                    </span>
                    <span className="ml-2">
                      {t("admin.moderation.uploads.score", {
                        score: formatNumber(upload.score, {
                          maximumFractionDigits: 2,
                        }),
                      })}
                    </span>
                    <span className="ml-2">
                      {formatDate(upload.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </ClerkSession>
  );
}
