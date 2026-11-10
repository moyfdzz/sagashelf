import { useTranslation } from "react-i18next";

import { ProfilePagination } from "~/components/ProfilePagination";
import { ActionButton } from "~/components/moderation/ActionButton";
import { useFormatters } from "~/lib/format";
import { linkClass, secondaryButtonClass } from "~/lib/ui";

export type PanelAccount = {
  id: string;
  username: string;
  state: "suspended" | "banned";
  changedAt: number | null;
  note: string | null;
};

/** The accounts that are suspended or banned, each with the button that gives it back. */
export function RestrictedAccounts({
  accounts,
  page,
  hasMore,
}: {
  accounts: PanelAccount[];
  page: number;
  hasMore: boolean;
}) {
  const { t } = useTranslation();
  const { formatPanelTime } = useFormatters();

  return (
    <section aria-labelledby="moderation-accounts" className="mt-10">
      <h2 id="moderation-accounts" className="text-xl font-semibold">
        {t("admin.moderation.accounts.title")}
      </h2>
      {accounts.length === 0 ? (
        <p className="text-fg-muted mt-2">
          {t("admin.moderation.accounts.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="border-border bg-surface-raised rounded-md border p-4"
            >
              <p className="font-semibold break-words">
                <a
                  href={`/u/${encodeURIComponent(account.username)}`}
                  className={linkClass}
                >
                  {account.username}
                </a>
              </p>
              <p className="text-fg-muted mt-1 text-sm">
                <span className="font-semibold">
                  {t(`admin.moderation.accounts.state.${account.state}`)}
                </span>
                {account.changedAt === null ? null : (
                  <span className="ml-2">
                    {formatPanelTime(account.changedAt)}
                  </span>
                )}
              </p>
              {account.note ? (
                <p className="mt-2 text-sm break-words whitespace-pre-line">
                  <span className="font-semibold">
                    {t("admin.moderation.accounts.note")}
                  </span>{" "}
                  {account.note}
                </p>
              ) : null}
              <div className="mt-3">
                <ActionButton
                  intent="lift"
                  fields={{ id: account.id }}
                  className={secondaryButtonClass}
                >
                  {t("admin.moderation.accounts.lift")}
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* A page past the last one (accounts lifted meanwhile) still offers the way back. */}
      <ProfilePagination
        page={page}
        hasMore={hasMore}
        pathTo={(toPage) => `/admin/moderation?page=${toPage}`}
        label={t("admin.moderation.accounts.title")}
        plain
      />
    </section>
  );
}
