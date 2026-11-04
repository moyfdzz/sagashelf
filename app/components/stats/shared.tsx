import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnChart } from "~/components/charts/ColumnChart";
import { useFormatters } from "~/lib/format";
import {
  minutesToDays,
  minutesToHours,
  type lastYears,
} from "~/lib/stats-view";
import type { StatsPageData } from "~/routes/stats";

// The types, in the order of the colors of the charts: a type keeps its color on every chart.
export const typeOrder = [
  ["anime", "chart-1"],
  ["series", "chart-2"],
  ["movie", "chart-3"],
  ["book", "chart-4"],
  ["manga", "chart-5"],
] as const;

export const statusOrder = [
  "planned",
  "in_progress",
  "completed",
  "paused",
  "dropped",
] as const;

export function Panel({
  id,
  title,
  description,
  wide,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  /** Takes both columns of the grid. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      // `min-w-0`: a grid item grows to the width of its content, and an open table with many
      // columns must scroll inside its own box instead of widening the page.
      className={wide ? "min-w-0 space-y-3 lg:col-span-2" : "min-w-0 space-y-3"}
    >
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {description ? <p className="text-fg-muted">{description}</p> : null}
      {children}
    </section>
  );
}

/**
 * The small functions every panel of the page uses: the address of a bar in the library, the
 * names of the months, the labels of a type, and the texts of a count, of hours and of days.
 */
export function useStatsHelpers(type: StatsPageData["type"]) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  // Where a bar leads: the library with the filter of the bar, and the tab's type when there is one.
  // The type goes first, as the library writes its own addresses.
  const libraryHref = (filter: Record<string, string | number>) => {
    const params = new URLSearchParams(type ? { type } : {});
    for (const [key, value] of Object.entries(filter)) {
      params.set(key, String(value));
    }
    return `/library?${params}`;
  };
  const monthName = (month: number, style: "narrow" | "long") =>
    formatDate(new Date(Date.UTC(2000, month - 1, 15)), { month: style });
  const titles = (count: number) => t("stats.titles", { count });
  const known = new Set<string>(typeOrder.map(([type]) => type));
  const typeLabel = (type: string) =>
    known.has(type)
      ? t(`library.tabs.${type as (typeof typeOrder)[number][0]}`)
      : t("stats.types.other");
  const withYear = (type: string, year: number | null) =>
    year ? `${typeLabel(type)} · ${year}` : typeLabel(type);
  const yearColumns = (
    list: ReturnType<typeof lastYears>,
    link: boolean,
  ): Parameters<typeof ColumnChart>[0]["columns"] =>
    list.map(({ year, count }) => ({
      key: String(year),
      label: String(year),
      value: count,
      href: link && count > 0 ? libraryHref({ year }) : undefined,
      title: t("stats.point", { label: year, value: titles(count) }),
    }));
  const hours = (minutes: number) =>
    t("stats.hours", {
      value: formatNumber(minutesToHours(minutes), {
        maximumFractionDigits: 1,
      }),
    });
  const daysText = (minutes: number) => {
    const total = minutesToDays(minutes);
    return t("stats.days", {
      count: total,
      value: formatNumber(total, { maximumFractionDigits: 1 }),
    });
  };
  // The genres (SAG-86): a title with several is in each one. A bar leads to the library with the
  // genre as a filter, as a plain link because the library has its own security policy.
  const genreHref = (genre: string) => libraryHref({ genre });
  const orDash = (value: number, digits = 0) =>
    value > 0
      ? formatNumber(value, { maximumFractionDigits: digits })
      : t("stats.none");

  return {
    libraryHref,
    monthName,
    titles,
    known,
    typeLabel,
    withYear,
    yearColumns,
    hours,
    daysText,
    genreHref,
    orDash,
  };
}
