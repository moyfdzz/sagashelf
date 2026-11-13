import { useTranslation } from "react-i18next";

import { tabClass } from "~/lib/ui";

/**
 * The window of days of a statistics page (7, 30 or 90) as plain links, so each choice is an
 * address that can be kept (SAG-26). The page that uses it says where the links go.
 */
export function DaysNav({
  days,
  options,
  path,
}: {
  days: number;
  options: readonly number[];
  /** The page the links go to, with no query string. */
  path: string;
}) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("admin.stats.traffic.period.label")}>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === days;
          return (
            <li key={option}>
              <a
                href={`${path}?days=${option}`}
                aria-current={active ? "page" : undefined}
                className={tabClass(active)}
              >
                {t("admin.stats.traffic.period.days", { count: option })}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
