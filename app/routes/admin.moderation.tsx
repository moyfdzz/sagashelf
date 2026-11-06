import { createClerkClient } from "@clerk/backend";
import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.moderation";
import { AdminNav } from "~/components/AdminNav";
import { ClerkSession } from "~/components/ClerkSession";
import {
  ReportCard,
  type PanelReport,
} from "~/components/moderation/ReportCard";
import {
  PersonSearch,
  type PanelPerson,
} from "~/components/moderation/PersonSearch";
import { RestrictedAccounts } from "~/components/moderation/RestrictedAccounts";
import { useFormatters } from "~/lib/format";
import { linkClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { isReportReason, reasonsOf } from "~server/account/report-schema";
import { readAdminWrite } from "~server/auth/admin-write";
import { requireRole } from "~server/auth/require";
import {
  findPersonByUsername,
  listRestrictedAccounts,
} from "~server/db/account-actions";
import {
  listOpenReports,
  listSuspiciousUploads,
  queuePageSize,
} from "~server/db/moderation";
import { privateRouteHeaders } from "~server/http/cache";
import {
  asConfirmedAction,
  asModerationDetail,
  asModerationError,
  asModerationNotice,
  asPersonConfirm,
  asPersonName,
  asReportId,
  maxModerationFormBytes,
  moderationActionSchema,
} from "~server/moderation/panel-schema";
import { runModerationAction } from "~server/moderation/run-action";
import { getClerkKeys, getDb } from "~server/runtime-env";

const back = "/admin/moderation";

export async function loader(args: Route.LoaderArgs) {
  const admin = await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const params = new URL(args.request.url).searchParams;
  const view = asReportId(params.get("view"));
  const confirmId = asReportId(params.get("confirm"));
  const confirmAction = asConfirmedAction(params.get("do"));
  const db = await getDb();
  // The person asked for in the box "Act on a person" (SAG-146), found by username.
  const personName = asPersonName(params.get("person"));
  const [reports, uploads, accounts, person] = await Promise.all([
    listOpenReports(db, admin.id),
    listSuspiciousUploads(db),
    listRestrictedAccounts(db, queuePageSize),
    personName ? findPersonByUsername(db, admin.id, personName) : null,
  ]);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.moderation.title") }),
    publishableKey: keys.publishableKey,
    notice: asModerationNotice(params.get("notice")),
    error: asModerationError(params.get("error")),
    // Why Clerk refused (status and code), only for the error that says so.
    detail:
      params.get("error") === "failed"
        ? asModerationDetail(params.get("detail"))
        : null,
    // The action asked to be confirmed, and the report it is about. Both or none.
    confirm:
      confirmId && confirmAction
        ? { id: confirmId, action: confirmAction }
        : null,
    personQuery: personName,
    person: person
      ? {
          id: person.userId,
          username: person.username,
          displayName: person.displayName,
          account: person.state,
          protected: person.protected,
        }
      : null,
    // A modal for the person of the card. A report has its own, so only one is ever asked for.
    personConfirm:
      person && !confirmId ? asPersonConfirm(params.get("do")) : null,
    personWarnReasons: reasonsOf("user"),
    // A picture reported for minors is only sent when the reviewer asked for that one. The address
    // never reaches the browser otherwise, and only an https one is ever drawn.
    reports: reports.map((report) => {
      const warnReasons = reasonsOf(report.kind);
      return {
        ...report,
        createdAt: report.createdAt.getTime(),
        pictureUrl:
          report.pictureUrl?.startsWith("https://") &&
          (!report.sensitive || report.id === view)
            ? report.pictureUrl
            : null,
        // The reason as the list of warnings knows it, or null for an old one with no text.
        reasonKey: isReportReason(report.reason) ? report.reason : null,
        warnReasons,
        warnSelected: warnReasons.find((r) => r === report.reason) ?? "other",
      };
    }),
    uploads: uploads.map((upload) => ({
      ...upload,
      createdAt: upload.createdAt.getTime(),
    })),
    accounts: accounts.map((account) => ({
      id: account.id,
      username: account.username,
      state: account.state,
      changedAt: account.changedAt?.getTime() ?? null,
    })),
  }));
}

/**
 * Does what the administrator asked, as the administrator of the session, and goes back to the
 * panel saying how it went. The work is in `runModerationAction`.
 */
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
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });
  const clerk = createClerkClient({
    secretKey: keys.secretKey,
    publishableKey: keys.publishableKey,
  });
  const result = await runModerationAction(
    await getDb(),
    clerk.users,
    user.id,
    parsed.data,
  );
  return redirect(`${back}?${result}`, { status: 303 });
}

// A page with an administrator's work is never kept by a shared cache, and not indexed.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function AdminModeration({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatDate, formatNumber } = useFormatters();

  const cards: PanelReport[] = loaderData.reports.map((report) => ({
    id: report.id,
    kind: report.kind,
    reasonText: report.reasonKey
      ? t(`report.reasons.${report.reasonKey}`)
      : null,
    details: report.details,
    createdAt: report.createdAt,
    username: report.username,
    pictureUrl: report.pictureUrl,
    hidden: report.hidden,
    current: report.current,
    sensitive: report.sensitive,
    account: report.account,
    protected: report.protected,
    warn: {
      options: report.warnReasons.map((reason) => ({
        value: reason,
        label: t(`report.reasons.${reason}`),
      })),
      selected: report.warnSelected,
    },
  }));

  const person: PanelPerson | null = loaderData.person;
  const personWarn = {
    options: loaderData.personWarnReasons.map((reason) => ({
      value: reason,
      label: t(`report.reasons.${reason}`),
    })),
    selected: "harassment",
  };

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
            {loaderData.error === "failed" && loaderData.detail
              ? t("admin.moderation.errors.failedWith", {
                  detail: loaderData.detail,
                })
              : t(`admin.moderation.errors.${loaderData.error}`)}
          </p>
        ) : null}

        <PersonSearch
          query={loaderData.personQuery}
          person={person}
          confirm={loaderData.personConfirm}
          warn={personWarn}
        />

        <section aria-labelledby="moderation-reports" className="mt-10">
          <h2 id="moderation-reports" className="text-xl font-semibold">
            {t("admin.moderation.reports.title")}
          </h2>
          {cards.length === 0 ? (
            <p className="text-fg-muted mt-2">
              {t("admin.moderation.reports.empty")}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {cards.map((card) => (
                <ReportCard
                  key={card.id}
                  report={card}
                  confirm={
                    loaderData.confirm?.id === card.id
                      ? loaderData.confirm.action
                      : null
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <RestrictedAccounts accounts={loaderData.accounts} />

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
