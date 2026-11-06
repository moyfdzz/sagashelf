import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useFormatters } from "~/lib/format";
import {
  dangerButtonClass,
  inputClass,
  linkClass,
  secondaryButtonClass,
  secondaryLinkClass,
} from "~/lib/ui";

export const moderationPage = "/admin/moderation";

export type ConfirmAction = "remove" | "suspend" | "ban";

/** A report as the card draws it. The texts that depend on a reason are made by the page. */
export type PanelReport = {
  id: string;
  kind: "picture" | "user";
  /** The reason in words, or null for an old reason that has no text. */
  reasonText: string | null;
  details: string | null;
  createdAt: number;
  username: string;
  /** Sent only for a picture the reviewer may see, and only over https. */
  pictureUrl: string | null;
  hidden: boolean;
  current: boolean;
  sensitive: boolean;
  account: "active" | "suspended" | "banned";
  protected: boolean;
  /** The reasons a warning can give, those of the kind of the report, and the one to start on. */
  warn: { options: { value: string; label: string }[]; selected: string };
};

/** A button that sends one action on one id as a POST of its own, and loads the page again. */
export function ActionButton({
  intent,
  id,
  className,
  children,
}: {
  intent: "dismiss" | "restore" | "remove" | "suspend" | "ban" | "lift";
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

function Confirmation({
  report,
  action,
}: {
  report: PanelReport;
  action: ConfirmAction;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={t(`admin.moderation.confirm.${action}.title`, {
        username: report.username,
      })}
      message={t(`admin.moderation.confirm.${action}.message`)}
      cancelHref={moderationPage}
      cancelLabel={t("admin.moderation.confirm.no")}
    >
      <ActionButton
        intent={action}
        id={report.id}
        className={dangerButtonClass}
      >
        {t(`admin.moderation.confirm.${action}.yes`)}
      </ActionButton>
    </ConfirmDialog>
  );
}

/** The actions on the person of the report: warn, suspend or ban. */
function PersonActions({ report }: { report: PanelReport }) {
  const { t } = useTranslation();
  const open = (action: ConfirmAction) =>
    `${moderationPage}?confirm=${report.id}&do=${action}`;

  if (report.protected) {
    return (
      <p className="text-fg-muted mt-4 text-sm">
        {t("admin.moderation.reports.protected")}
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      <p className="text-fg-muted text-sm font-semibold">
        {t("admin.moderation.reports.personActions")}
        {report.account === "active" ? null : (
          <span className="text-fg ml-2">
            {t(`admin.moderation.reports.account.${report.account}`)}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {report.account === "active" && !report.hidden ? (
          <Form
            method="post"
            reloadDocument
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="intent" value="warn" />
            <input type="hidden" name="id" value={report.id} />
            <label className="block">
              <span className="text-sm font-semibold">
                {t("admin.moderation.reports.warnReason")}
              </span>
              <select
                name="reason"
                defaultValue={report.warn.selected}
                className={`${inputClass} w-auto`}
              >
                {report.warn.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={secondaryButtonClass}>
              {t("admin.moderation.reports.warn")}
            </button>
          </Form>
        ) : null}
        {report.account === "active" ? (
          <Link
            to={open("suspend")}
            preventScrollReset
            className={`${secondaryButtonClass} inline-block`}
          >
            {t("admin.moderation.reports.suspend")}
          </Link>
        ) : null}
        {report.account !== "banned" ? (
          <Link
            to={open("ban")}
            preventScrollReset
            className={`${dangerButtonClass} inline-block`}
          >
            {t("admin.moderation.reports.ban")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** One open report, with what the reviewer needs and the actions of the picture and of the person. */
export function ReportCard({
  report,
  confirm,
}: {
  report: PanelReport;
  confirm: ConfirmAction | null;
}) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const isPicture = report.kind === "picture";
  // Only a picture that is still the person's can be judged, and a hidden one cannot be dismissed.
  const actionable = isPicture && report.current;
  // A dialog asks only for an action that can be taken now.
  const asking =
    confirm === "remove"
      ? actionable
      : confirm !== null && !report.protected && report.account !== "banned";

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
          {report.reasonText ?? t("admin.moderation.reports.unknownReason")}
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
              <Link
                to={`${moderationPage}?view=${report.id}`}
                preventScrollReset
                className={secondaryLinkClass}
              >
                {t("admin.moderation.reports.view")}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

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
          // A link of the router: the modal opens without loading the page again.
          <Link
            to={`${moderationPage}?confirm=${report.id}&do=remove`}
            preventScrollReset
            className={`${dangerButtonClass} inline-block`}
          >
            {t("admin.moderation.reports.remove")}
          </Link>
        ) : null}
      </div>

      <PersonActions report={report} />

      {confirm && asking ? (
        <Confirmation report={report} action={confirm} />
      ) : null}
    </li>
  );
}
