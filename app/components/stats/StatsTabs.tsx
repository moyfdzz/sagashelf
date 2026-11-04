import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { tabClass } from "~/lib/ui";

// The tabs (SAG-91): all of them, then one per type. Each is a plain address, so it works without
// JavaScript and can be kept as a bookmark. The labels are the ones of the library tabs.
export const tabTypes = [
  null,
  "movie",
  "series",
  "anime",
  "book",
  "manga",
] as const;

/**
 * The row of tabs. The statistics page is not a session page, so a move between its tabs is a
 * router link, which keeps the back button honest and asks only for the data of the page.
 */
export function StatsTabs({ type }: { type: (typeof tabTypes)[number] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("library.tabs.label")} className="mt-6">
      <ul className="flex flex-wrap gap-2">
        {tabTypes.map((tab) => {
          const active = type === tab;
          return (
            <li key={tab ?? "all"}>
              <Link
                to={tab ? `/stats?type=${tab}` : "/stats"}
                aria-current={active ? "page" : undefined}
                className={tabClass(active)}
              >
                {t(`library.tabs.${tab ?? "all"}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
