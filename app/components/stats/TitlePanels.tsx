import { useTranslation } from "react-i18next";

import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { StatsPageData } from "~/routes/stats";
import { bestPeriods } from "~/lib/stats-view";
import { linkClass } from "~/lib/ui";
import { Panel, useStatsHelpers } from "./shared";

/** The titles that stand out: the most watched, the most watched again, the pace and the oldest planned. */
export function TitlePanels({
  stats,
  type,
}: {
  stats: StatsPageData["stats"];
  type: StatsPageData["type"];
}) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  const { monthName, withYear, hours } = useStatsHelpers(type);
  const rewatchLine = (entry: (typeof stats.mostRewatched)[number]) => {
    const times = t("stats.rewatched.times", { count: entry.rewatches });
    return entry.minutes > 0 ? `${times} · ${hours(entry.minutes)}` : times;
  };

  const best = bestPeriods(stats.finishedByYear, stats.finishedByMonth);
  const paceTiles: [string, string][] = [];
  if (best.year) {
    paceTiles.push([
      t("stats.pace.bestYear", { count: best.year.count }),
      String(best.year.year),
    ]);
  }
  if (best.month) {
    paceTiles.push([
      t("stats.pace.bestMonth", { count: best.month.count }),
      `${monthName(best.month.month, "long")} ${best.month.year}`,
    ]);
  }
  if (stats.finishTime.medianDays !== null) {
    paceTiles.push([
      t("stats.pace.median"),
      formatNumber(stats.finishTime.medianDays, { maximumFractionDigits: 1 }),
    ]);
  }

  return (
    <>
      {stats.mostWatched.length > 0 ? (
        <Panel
          id="stats-most-watched"
          title={t("stats.mostWatched.title")}
          description={t("stats.mostWatched.description")}
        >
          <RowBars
            rows={stats.mostWatched.map((entry) => ({
              key: entry.mediaId,
              label: `${entry.title} (${withYear(entry.type, entry.year)})`,
              value: entry.minutes,
              href: `/library/${entry.mediaId}`,
            }))}
            format={hours}
          />
        </Panel>
      ) : null}

      {stats.mostRewatched.length > 0 ? (
        <Panel
          id="stats-most-rewatched"
          title={t("stats.rewatched.title")}
          description={t("stats.rewatched.description")}
        >
          <ol className="max-w-md space-y-2">
            {stats.mostRewatched.map((entry) => (
              <li key={entry.mediaId} className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1">
                  <a href={`/library/${entry.mediaId}`} className={linkClass}>
                    {entry.title}
                  </a>{" "}
                  <span className="text-fg-muted text-sm">
                    {withYear(entry.type, entry.year)}
                  </span>
                </span>
                <span className="text-sm tabular-nums">
                  {rewatchLine(entry)}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {paceTiles.length > 0 ? (
        <Panel
          id="stats-pace"
          title={t("stats.pace.title")}
          description={t("stats.pace.description")}
          wide
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {paceTiles.map(([label, value]) => (
              <div
                key={label}
                className="border-border bg-surface-raised rounded-md border p-4"
              >
                <dd className="text-2xl font-semibold">{value}</dd>
                <dt className="text-fg-muted mt-1 text-sm">{label}</dt>
              </div>
            ))}
          </dl>
          {stats.finishTime.skipped > 0 ? (
            <p className="text-fg-muted text-sm">
              {t("stats.pace.skipped", { count: stats.finishTime.skipped })}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {stats.oldestPlanned.length > 0 ? (
        <Panel
          id="stats-oldest-planned"
          title={t("stats.oldestPlanned.title")}
          description={t("stats.oldestPlanned.description")}
        >
          <ol className="max-w-md space-y-2">
            {stats.oldestPlanned.map((entry) => (
              <li key={entry.mediaId} className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1">
                  <a href={`/library/${entry.mediaId}`} className={linkClass}>
                    {entry.title}
                  </a>{" "}
                  <span className="text-fg-muted text-sm">
                    {withYear(entry.type, entry.year)}
                  </span>
                </span>
                <span className="text-fg-muted text-sm tabular-nums">
                  {formatDate(new Date(`${entry.addedOn}T00:00:00Z`), {
                    dateStyle: "medium",
                  })}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </>
  );
}
