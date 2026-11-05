import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { secondaryLinkClass } from "~/lib/ui";

/** Previous and next for a list that hangs from a profile. Nothing when it fits in one page. */
export function ProfilePagination({
  page,
  hasMore,
  pathTo,
}: {
  page: number;
  hasMore: boolean;
  pathTo: (page: number) => string;
}) {
  const { t } = useTranslation();
  if (page <= 1 && !hasMore) return null;
  return (
    <nav
      aria-label={t("profile.people.pagination")}
      className="mt-6 flex flex-wrap items-center gap-3"
    >
      {page > 1 ? (
        <Link to={pathTo(page - 1)} className={secondaryLinkClass}>
          {t("profile.people.previous")}
        </Link>
      ) : null}
      <span className="text-fg-muted">
        {t("profile.people.page", { page })}
      </span>
      {hasMore ? (
        <Link to={pathTo(page + 1)} className={secondaryLinkClass}>
          {t("profile.people.next")}
        </Link>
      ) : null}
    </nav>
  );
}
