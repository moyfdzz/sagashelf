import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import { moderationPage } from "~/components/moderation/ActionButton";
import { dangerButtonClass, inputClass, secondaryButtonClass } from "~/lib/ui";

/**
 * What the actions are about: the person of an open report, or a person named by username with no
 * report (SAG-146). The second sends the username, which the server resolves, and a short note.
 */
export type PersonTarget =
  { kind: "report"; id: string } | { kind: "person"; username: string };

export type AccountStatus = "active" | "suspended" | "banned";

/** The actions on a person: warn with a reason of a list, suspend and ban (which open a modal). */
export function PersonActions({
  target,
  account,
  isProtected,
  pictureHidden,
  warn,
}: {
  target: PersonTarget;
  account: AccountStatus;
  isProtected: boolean;
  /** The reported picture is hidden: it is decided first, and a warning waits. */
  pictureHidden: boolean;
  /** The reasons a warning can give, and the one to start on. */
  warn: { options: { value: string; label: string }[]; selected: string };
}) {
  const { t } = useTranslation();
  const direct = target.kind === "person";
  const suffix = direct ? "_person" : "";
  const field = direct
    ? { name: "username", value: target.username }
    : { name: "id", value: target.id };
  // The address that opens the modal: the report to confirm, or the card of the person.
  const open = (action: "suspend" | "ban") =>
    direct
      ? `${moderationPage}?person=${encodeURIComponent(target.username)}&do=${action}`
      : `${moderationPage}?confirm=${target.id}&do=${action}`;

  if (isProtected) {
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
        {account === "active" ? null : (
          <span className="text-fg ml-2">
            {t(`admin.moderation.reports.account.${account}`)}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {account === "active" && !pictureHidden ? (
          <Form
            method="post"
            reloadDocument
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="intent" value={`warn${suffix}`} />
            <input type="hidden" name={field.name} value={field.value} />
            <label className="block">
              <span className="text-sm font-semibold">
                {t("admin.moderation.reports.warnReason")}
              </span>
              <select
                name="reason"
                defaultValue={warn.selected}
                className={`${inputClass} w-auto`}
              >
                {warn.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {direct ? (
              <label className="block">
                <span className="text-sm font-semibold">
                  {t("admin.moderation.person.note")}
                </span>
                <input
                  name="note"
                  maxLength={200}
                  className={`${inputClass} w-auto`}
                />
              </label>
            ) : null}
            <button type="submit" className={secondaryButtonClass}>
              {t("admin.moderation.reports.warn")}
            </button>
          </Form>
        ) : null}
        {account === "active" ? (
          <Link
            to={open("suspend")}
            preventScrollReset
            className={`${secondaryButtonClass} inline-block`}
          >
            {t("admin.moderation.reports.suspend")}
          </Link>
        ) : null}
        {account !== "banned" ? (
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
