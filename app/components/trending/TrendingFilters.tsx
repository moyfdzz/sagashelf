import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { tabClass } from "~/lib/ui";

// The types of the tabs, and the periods of the selector, as the address says them (SAG-23). The
// two sets of links are plain addresses, so the page works without JavaScript and each view can
// be kept as a bookmark.
const types = ["movie", "series", "anime", "book", "manga"] as const;
const recent = ["week", "month", "year"] as const;

export type TrendingFiltersProps = {
  type: string;
  period: string;
  /** The closed calendar years that can be asked for, the latest first. */
  pastYears: number[];
  /** The address of a view, so the links and the canonical address come from one place. */
  pathFor: (view: { type: string; period: string }) => string;
};

export function TrendingFilters({
  type,
  period,
  pastYears,
  pathFor,
}: TrendingFiltersProps) {
  const { t } = useTranslation();
  const periods = [...recent, ...pastYears.map(String)];

  return (
    <>
      <nav aria-label={t("library.tabs.label")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {types.map((tab) => (
            <li key={tab}>
              <Link
                to={pathFor({ type: tab, period })}
                aria-current={tab === type ? "page" : undefined}
                className={tabClass(tab === type)}
              >
                {t(`library.tabs.${tab}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label={t("trending.period.label")} className="mt-3">
        <ul className="flex flex-wrap gap-2">
          {periods.map((choice) => (
            <li key={choice}>
              <Link
                to={pathFor({ type, period: choice })}
                aria-current={choice === period ? "page" : undefined}
                className={tabClass(choice === period)}
              >
                {choice === "week" || choice === "month" || choice === "year"
                  ? t(`trending.period.${choice}`)
                  : choice}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
