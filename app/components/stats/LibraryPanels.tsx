import { useTranslation } from "react-i18next";

import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart } from "~/components/charts/ColumnChart";
import { HeatMap } from "~/components/charts/HeatMap";
import { useFormatters } from "~/lib/format";
import type { StatsPageData } from "~/routes/stats";
import { heatRows, lastYears } from "~/lib/stats-view";
import { linkClass } from "~/lib/ui";
import { Panel, useStatsHelpers } from "./shared";

/** The titles by year of release, the best scored and the heat map of the months. */
export function LibraryPanels({
  stats,
  type,
}: {
  stats: StatsPageData["stats"];
  type: StatsPageData["type"];
}) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const { monthName, titles, withYear, yearColumns } = useStatsHelpers(type);
  const released = lastYears(stats.releasedByYear);
  const heat = heatRows(stats.finishedByMonth);

  return (
    <>
      {released.length > 0 ? (
        <Panel
          id="stats-released"
          title={t("stats.released.title")}
          description={t("stats.released.description")}
        >
          <ColumnChart
            columns={yearColumns(released, true)}
            format={formatNumber}
          />
          <ChartTable
            summary={t("stats.showNumbers")}
            headers={[t("stats.finished.year"), t("stats.titlesLabel")]}
            rows={released.map(({ year, count }) => [
              String(year),
              formatNumber(count),
            ])}
          />
        </Panel>
      ) : null}

      {stats.best.length > 0 ? (
        <Panel id="stats-best" title={t("stats.best.title")}>
          <ol className="max-w-md space-y-2">
            {stats.best.map((entry, index) => (
              <li key={entry.mediaId} className="flex items-baseline gap-3">
                <span className="text-fg-muted w-6 text-right tabular-nums">
                  {formatNumber(index + 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <a href={`/library/${entry.mediaId}`} className={linkClass}>
                    {entry.title}
                  </a>{" "}
                  <span className="text-fg-muted text-sm">
                    {withYear(entry.type, entry.year)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">
                  {t("stats.best.score", { score: entry.score })}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {heat.length > 0 ? (
        <Panel
          id="stats-activity"
          title={t("stats.activity.title")}
          description={t("stats.activity.description")}
        >
          <HeatMap
            months={Array.from({ length: 12 }, (_, month) =>
              monthName(month + 1, "narrow"),
            )}
            less={t("stats.activity.less")}
            more={t("stats.activity.more")}
            rows={heat.map((row) => ({
              label: String(row.year),
              cells: row.months.map((count, month) => ({
                value: count,
                title: t("stats.point", {
                  label: `${monthName(month + 1, "long")} ${row.year}`,
                  value: titles(count),
                }),
              })),
            }))}
          />
          <ChartTable
            summary={t("stats.showNumbers")}
            headers={[t("stats.activity.month"), t("stats.titlesLabel")]}
            rows={heat.flatMap((row) =>
              row.months.flatMap((count, month) =>
                count > 0
                  ? [
                      [
                        `${monthName(month + 1, "long")} ${row.year}`,
                        formatNumber(count),
                      ],
                    ]
                  : [],
              ),
            )}
          />
        </Panel>
      ) : null}
    </>
  );
}
