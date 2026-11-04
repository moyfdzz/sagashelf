import { useTranslation } from "react-i18next";

import { ProportionBar, type Segment } from "~/components/charts/ProportionBar";
import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { StatsPageData } from "~/routes/stats";
import { Panel, typeOrder, useStatsHelpers } from "./shared";

/** The time and the score of each type, on the tab that has them all. */
export function TypePanels({
  stats,
  type,
}: {
  stats: StatsPageData["stats"];
  type: StatsPageData["type"];
}) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const { titles, daysText } = useStatsHelpers(type);
  const timeSegments: Segment[] = typeOrder.flatMap(([type, tone]) =>
    (stats.minutesByType[type] ?? 0) > 0
      ? [
          {
            key: type,
            label: t(`library.tabs.${type}`),
            value: stats.minutesByType[type] ?? 0,
            tone,
          },
        ]
      : [],
  );
  const scoreRows = typeOrder.flatMap(([type]) => {
    const scored = stats.scoreByType[type];
    return scored
      ? [
          {
            key: type,
            label: `${t(`library.tabs.${type}`)} · ${titles(scored.scored)}`,
            value: scored.average,
          },
        ]
      : [];
  });

  return (
    <>
      {!type && timeSegments.length > 0 ? (
        <Panel
          id="stats-time-by-type"
          title={t("stats.timeByType.title")}
          description={t("stats.timeByType.description")}
        >
          <ProportionBar
            segments={timeSegments}
            format={daysText}
            formatShare={(share) => formatNumber(share, { style: "percent" })}
          />
        </Panel>
      ) : null}

      {!type && scoreRows.length > 0 ? (
        <Panel
          id="stats-score-by-type"
          title={t("stats.scoreByType.title")}
          description={t("stats.scoreByType.description")}
        >
          <RowBars
            rows={scoreRows}
            scaleMax={10}
            format={(value) =>
              formatNumber(value, { maximumFractionDigits: 1 })
            }
          />
        </Panel>
      ) : null}
    </>
  );
}
