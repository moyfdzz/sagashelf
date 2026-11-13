import { useTranslation } from "react-i18next";

import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart, type Column } from "~/components/charts/ColumnChart";
import { useFormatters } from "~/lib/format";
import type { AdminOverview } from "~/routes/admin.stats";

const tileKeys = [
  "totalUsers",
  "newToday",
  "newLast30Days",
  "newLast365Days",
  "activeLast7Days",
  "activeLast30Days",
  "entriesTracked",
  "titlesTracked",
] as const;

/** The overview of the dashboard: the main numbers and the new accounts of each day, with a table. */
export function OverviewPanel({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();

  const dateOf = (day: string) =>
    formatDate(new Date(`${day}T00:00:00Z`), { dateStyle: "medium" });

  const columns: Column[] = overview.signups.map((row) => ({
    key: row.day,
    // The day of the month is enough under a column; the table has the whole date.
    label: String(Number(row.day.slice(8, 10))),
    value: row.count,
    title: t("admin.stats.signups.columnTitle", {
      date: dateOf(row.day),
      count: row.count,
    }),
  }));

  return (
    <section aria-labelledby="admin-overview" className="mt-8">
      <h2 id="admin-overview" className="sr-only">
        {t("admin.stats.sections.overview")}
      </h2>
      <dl
        aria-label={t("admin.stats.tiles.label")}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {tileKeys.map((key) => (
          <div
            key={key}
            className="border-border bg-surface-raised rounded-md border p-4"
          >
            <dd className="text-3xl font-semibold tabular-nums">
              {formatNumber(overview[key])}
            </dd>
            <dt className="text-fg-muted mt-1 text-sm">
              {t(`admin.stats.tiles.${key}`)}
            </dt>
          </div>
        ))}
      </dl>
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.activeNote")}
      </p>

      <h3 className="mt-10 text-xl font-semibold">
        {t("admin.stats.signups.heading")}
      </h3>
      <p className="text-fg-muted mt-1 mb-4 text-sm">
        {t("admin.stats.signups.description")}
      </p>
      <ColumnChart columns={columns} format={(value) => formatNumber(value)} />
      <ChartTable
        summary={t("admin.stats.signups.showNumbers")}
        headers={[t("admin.stats.signups.day"), t("admin.stats.signups.count")]}
        rows={overview.signups.map((row) => [
          dateOf(row.day),
          formatNumber(row.count),
        ])}
      />
    </section>
  );
}
