import { useTranslation } from "react-i18next";

import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart } from "~/components/charts/ColumnChart";
import { ProportionBar, type Segment } from "~/components/charts/ProportionBar";
import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { StatsPageData } from "~/routes/stats";
import { lastYears } from "~/lib/stats-view";
import { Panel, statusOrder, typeOrder, useStatsHelpers } from "./shared";

/** The scores, the titles finished by year, the types and the statuses. */
export function OverviewPanels({
  stats,
  type,
}: {
  stats: StatsPageData["stats"];
  type: StatsPageData["type"];
}) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const { libraryHref, titles, known, yearColumns } = useStatsHelpers(type);
  const scoreColumns = stats.scores.map((count, index) => ({
    key: String(index + 1),
    label: formatNumber(index + 1),
    value: count,
    href: count > 0 ? libraryHref({ rated: index + 1 }) : undefined,
    title: t("stats.point", {
      label: formatNumber(index + 1),
      value: titles(count),
    }),
  }));
  const finished = lastYears(stats.finishedByYear);
  const otherTypes = Object.entries(stats.byType)
    .filter(([type]) => !known.has(type))
    .reduce((sum, [, count]) => sum + count, 0);
  const segments: Segment[] = [
    ...typeOrder.map(([type, tone]) => ({
      key: type,
      label: t(`library.tabs.${type}`),
      value: stats.byType[type] ?? 0,
      tone,
    })),
    {
      key: "other",
      label: t("stats.types.other"),
      value: otherTypes,
      tone: "chart-other" as const,
    },
  ];

  return (
    <>
      <Panel
        id="stats-scores"
        title={t("stats.scores.title")}
        description={t("stats.scores.description")}
      >
        {stats.scored === 0 ? (
          <p>{t("stats.scores.none")}</p>
        ) : (
          <>
            <ColumnChart columns={scoreColumns} format={formatNumber} />
            <p className="text-sm">
              {t("stats.scores.summary", {
                count: stats.scored,
                average: formatNumber(stats.averageScore ?? 0, {
                  maximumFractionDigits: 1,
                }),
              })}
            </p>
            <ChartTable
              summary={t("stats.showNumbers")}
              headers={[t("stats.scores.score"), t("stats.titlesLabel")]}
              rows={stats.scores.map((count, index) => [
                formatNumber(index + 1),
                formatNumber(count),
              ])}
            />
          </>
        )}
      </Panel>

      <Panel
        id="stats-finished"
        title={t("stats.finished.title")}
        description={t("stats.finished.description")}
      >
        {finished.length === 0 ? (
          <p>{t("stats.finished.none")}</p>
        ) : (
          <>
            <ColumnChart
              columns={yearColumns(finished, false)}
              format={formatNumber}
            />
            <ChartTable
              summary={t("stats.showNumbers")}
              headers={[t("stats.finished.year"), t("stats.titlesLabel")]}
              rows={finished.map(({ year, count }) => [
                String(year),
                formatNumber(count),
              ])}
            />
          </>
        )}
        {stats.undatedFinished > 0 ? (
          <p className="text-fg-muted text-sm">
            {t("stats.finished.undated", { count: stats.undatedFinished })}
          </p>
        ) : null}
      </Panel>

      {/* The panels that compare types say nothing on the tab of a single type. */}
      {type ? null : (
        <Panel id="stats-types" title={t("stats.types.title")}>
          <ProportionBar
            segments={segments}
            format={formatNumber}
            formatShare={(share) => formatNumber(share, { style: "percent" })}
          />
        </Panel>
      )}

      <Panel id="stats-statuses" title={t("stats.statuses.title")}>
        <RowBars
          format={formatNumber}
          rows={statusOrder.map((status) => ({
            key: status,
            label: t(`library.status.${status}`),
            value: stats.byStatus[status] ?? 0,
          }))}
        />
      </Panel>
    </>
  );
}
