import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useFormatters } from "~/lib/format";
import { dangerButtonClass, linkClass, secondaryButtonClass } from "~/lib/ui";

export type PanelMessage = {
  id: string;
  kind: "feedback" | "problem" | "help";
  body: string;
  replyEmail: string | null;
  status: "new" | "handled";
  username: string | null;
  createdAt: number;
};

const page = "/admin/messages";

/** One button that sends one action as a POST of its own and loads the page again. */
function ActionForm({
  intent,
  id,
  className,
  children,
}: {
  intent: string;
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

/**
 * A message of the contact page, for an administrator: the kind, who wrote it and when, the text as
 * plain text, and the buttons. Deleting is a red button that asks first in a modal (SAG-125), which
 * the address opens, so it works without a script.
 */
export function MessageCard({
  message,
  confirming,
}: {
  message: PanelMessage;
  confirming: boolean;
}) {
  const { t } = useTranslation();
  const { formatPanelTime } = useFormatters();

  return (
    <li className="border-border bg-surface-raised rounded-md border p-4">
      <p className="font-semibold break-words">
        {t(`contact.kinds.${message.kind}`)}
        <span className="text-fg-muted ml-2 text-sm">
          {t(`admin.messages.state.${message.status}`)}
        </span>
      </p>
      <p className="text-fg-muted mt-1 text-sm break-words">
        {message.username ? (
          <a
            href={`/u/${encodeURIComponent(message.username)}`}
            className={linkClass}
          >
            {message.username}
          </a>
        ) : (
          <span>{t("admin.messages.fromVisitor")}</span>
        )}
        <span className="ml-2">
          {t("admin.messages.sentAt")} {formatPanelTime(message.createdAt)}
        </span>
      </p>
      {message.replyEmail ? (
        <p className="mt-1 text-sm break-all">
          <span className="font-semibold">{t("admin.messages.replyTo")}</span>{" "}
          {message.replyEmail}
        </p>
      ) : null}
      <p className="mt-2 break-words whitespace-pre-line">{message.body}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {message.status === "new" ? (
          <ActionForm
            intent="handled"
            id={message.id}
            className={secondaryButtonClass}
          >
            {t("admin.messages.markHandled")}
          </ActionForm>
        ) : (
          <ActionForm
            intent="reopen"
            id={message.id}
            className={secondaryButtonClass}
          >
            {t("admin.messages.reopen")}
          </ActionForm>
        )}
        {/* A link of the router: the modal opens without loading the page again. */}
        <Link
          to={`${page}?confirm=${message.id}`}
          preventScrollReset
          className={`${dangerButtonClass} inline-block`}
        >
          {t("admin.messages.delete")}
        </Link>
      </div>

      {confirming ? (
        <ConfirmDialog
          title={t("admin.messages.confirmTitle")}
          message={t("admin.messages.confirmBody")}
          cancelHref={page}
          cancelLabel={t("admin.messages.confirmNo")}
        >
          <ActionForm
            intent="delete"
            id={message.id}
            className={dangerButtonClass}
          >
            {t("admin.messages.confirmYes")}
          </ActionForm>
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
