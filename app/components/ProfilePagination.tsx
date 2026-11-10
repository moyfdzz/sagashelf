import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { secondaryLinkClass } from "~/lib/ui";

/**
 * Previous and next for a list that hangs from a profile or a panel. Nothing when it fits in one
 * page. `label` names the list for a screen reader; `plain` draws ordinary links, which the pages
 * that need a session use (ADR-018).
 */
export function ProfilePagination({
  page,
  hasMore,
  pathTo,
  label,
  plain = false,
}: {
  page: number;
  hasMore: boolean;
  pathTo: (page: number) => string;
  label?: string;
  plain?: boolean;
}) {
  const { t } = useTranslation();
  if (page <= 1 && !hasMore) return null;
  const step = (toPage: number, text: string) =>
    plain ? (
      <a href={pathTo(toPage)} className={secondaryLinkClass}>
        {text}
      </a>
    ) : (
      <Link to={pathTo(toPage)} className={secondaryLinkClass}>
        {text}
      </Link>
    );
  return (
    <nav
      aria-label={label ?? t("profile.people.pagination")}
      className="mt-6 flex flex-wrap items-center gap-3"
    >
      {page > 1 ? step(page - 1, t("profile.people.previous")) : null}
      <span className="text-fg-muted">
        {t("profile.people.page", { page })}
      </span>
      {hasMore ? step(page + 1, t("profile.people.next")) : null}
    </nav>
  );
}
