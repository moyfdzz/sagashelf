import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import {
  ActionButton,
  moderationPage,
} from "~/components/moderation/ActionButton";
import {
  PersonActions,
  type AccountStatus,
} from "~/components/moderation/PersonActions";
import {
  dangerButtonClass,
  inputClass,
  linkClass,
  secondaryButtonClass,
} from "~/lib/ui";

/** The person of the card, as the page draws it. */
export type PanelPerson = {
  id: string;
  username: string;
  displayName: string | null;
  account: AccountStatus;
  /** An administrator, or the one asking: nothing is done to them from here. */
  protected: boolean;
};

function Confirmation({
  person,
  action,
}: {
  person: PanelPerson;
  action: "suspend" | "ban";
}) {
  const { t } = useTranslation();
  const formId = useId();
  return (
    <ConfirmDialog
      title={t(`admin.moderation.confirm.${action}.title`, {
        username: person.username,
      })}
      message={t(`admin.moderation.confirm.${action}.message`)}
      // Back to the card, not to the whole panel.
      cancelHref={`${moderationPage}?person=${encodeURIComponent(person.username)}`}
      cancelLabel={t("admin.moderation.confirm.no")}
      extra={
        <label className="block">
          <span className="text-sm font-semibold">
            {t("admin.moderation.person.note")}
          </span>
          {/* Sent with the form of the button, which comes after it in the dialog. */}
          <input
            form={formId}
            name="note"
            maxLength={200}
            className={inputClass}
          />
        </label>
      }
    >
      <Form id={formId} method="post" reloadDocument>
        <input type="hidden" name="intent" value={`${action}_person`} />
        <input type="hidden" name="username" value={person.username} />
        <button type="submit" className={dangerButtonClass}>
          {t(`admin.moderation.confirm.${action}.yes`)}
        </button>
      </Form>
    </ConfirmDialog>
  );
}

/**
 * Act on a person with no report (SAG-146): a search by username, and the card of the person with
 * their state and the same actions as a report: warn, suspend, ban and lift.
 */
export function PersonSearch({
  query,
  person,
  confirm,
  warn,
}: {
  /** What was searched, or null when nothing was. */
  query: string | null;
  person: PanelPerson | null;
  confirm: "suspend" | "ban" | null;
  warn: { options: { value: string; label: string }[]; selected: string };
}) {
  const { t } = useTranslation();
  // A dialog asks only for an action that can be taken now.
  const asking =
    person !== null &&
    confirm !== null &&
    !person.protected &&
    (confirm === "suspend"
      ? person.account === "active"
      : person.account !== "banned");

  return (
    <section aria-labelledby="moderation-person" className="mt-8">
      <h2 id="moderation-person" className="text-xl font-semibold">
        {t("admin.moderation.person.title")}
      </h2>
      <p className="text-fg-muted mt-1 text-sm">
        {t("admin.moderation.person.description")}
      </p>
      <Form
        method="get"
        reloadDocument
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <label className="block">
          <span className="text-sm font-semibold">
            {t("admin.moderation.person.label")}
          </span>
          <input
            name="person"
            defaultValue={query ?? ""}
            required
            maxLength={30}
            autoComplete="off"
            className={`${inputClass} w-auto`}
          />
        </label>
        <button type="submit" className={secondaryButtonClass}>
          {t("admin.moderation.person.search")}
        </button>
      </Form>

      {query !== null && person === null ? (
        <p role="status" className="text-fg-muted mt-3 break-words">
          {t("admin.moderation.person.notFound", { username: query })}
        </p>
      ) : null}

      {person ? (
        <div className="border-border bg-surface-raised mt-3 rounded-md border p-4">
          <p className="font-semibold break-words">
            <a
              href={`/u/${encodeURIComponent(person.username)}`}
              className={linkClass}
            >
              {person.username}
            </a>
            {person.displayName ? (
              <span className="text-fg-muted ml-2 font-normal">
                {person.displayName}
              </span>
            ) : null}
          </p>
          <PersonActions
            target={{ kind: "person", username: person.username }}
            account={person.account}
            isProtected={person.protected}
            pictureHidden={false}
            warn={warn}
          />
          {person.account !== "active" && !person.protected ? (
            <div className="mt-3">
              <ActionButton
                intent="lift"
                fields={{ id: person.id, username: person.username }}
                className={secondaryButtonClass}
              >
                {t("admin.moderation.accounts.lift")}
              </ActionButton>
            </div>
          ) : null}
          {asking && confirm ? (
            <Confirmation person={person} action={confirm} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
