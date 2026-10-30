import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/stats";
import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart } from "~/components/charts/ColumnChart";
import { HeatMap } from "~/components/charts/HeatMap";
import { ProportionBar, type Segment } from "~/components/charts/ProportionBar";
import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import { heatRows, lastYears, minutesToDays } from "~/lib/stats-view";
import { forwardLinkClass, linkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { getStats } from "~server/db/stats";
import { getDb } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const { t } = getInstance(args.context);
  const stats = await getStats(
    await getDb(),
    user.id,
    getLocale(args.context) === "en" ? "en" : "es",
  );
  return { title: t("app.pageTitle", { title: t("stats.title") }), stats };
}

// A page with a person's data is never kept by a shared cache.
export function headers() {
  return new Headers({ "Cache-Control": "private, no-store" });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

// The types, in the order of the colors of the charts: a type keeps its color on every chart.
const typeOrder = [
  ["anime", "chart-1"],
  ["series", "chart-2"],
  ["movie", "chart-3"],
  ["book", "chart-4"],
  ["manga", "chart-5"],
] as const;

const statusOrder = [
  "planned",
  "in_progress",
  "completed",
  "paused",
  "dropped",
] as const;

function Panel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {description ? <p className="text-fg-muted">{description}</p> : null}
      {children}
    </section>
  );
}

export default function Stats({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  const { stats } = loaderData;
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

  if (stats.entries === 0) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t("stats.title")}</h1>
        <p className="text-fg-muted mt-2">{t("stats.empty")}</p>
        <p className="mt-4">
          <Link to="/search" className={forwardLinkClass}>
            {t("stats.emptyLink")}
          </Link>
        </p>
      </main>
    );
  }

  const days = (minutes: number) =>
    minutes === 0 && stats.unknownRuntime > 0
      ? t("stats.none")
      : formatNumber(minutesToDays(minutes), { maximumFractionDigits: 1 });
  const tiles: [string, string][] = [
    [t("stats.tiles.completed"), formatNumber(stats.completed)],
    [t("stats.tiles.episodes"), formatNumber(stats.episodesWatched)],
    [t("stats.tiles.daysWatched"), days(stats.minutesWatched)],
    [t("stats.tiles.daysPlanned"), days(stats.minutesPlanned)],
    [
      t("stats.tiles.averageScore"),
      stats.averageScore === null
        ? t("stats.none")
        : formatNumber(stats.averageScore, { maximumFractionDigits: 1 }),
    ],
    [t("stats.tiles.rewatches"), formatNumber(stats.rewatches)],
  ];
  if (stats.pagesRead > 0) {
    tiles.push([t("stats.tiles.pages"), formatNumber(stats.pagesRead)]);
  }
  if (stats.chaptersRead > 0) {
    tiles.push([t("stats.tiles.chapters"), formatNumber(stats.chaptersRead)]);
  }
  if (stats.volumesRead > 0) {
    tiles.push([t("stats.tiles.volumes"), formatNumber(stats.volumesRead)]);
  }

  const runtimeNote =
    stats.unknownRuntime > 0
      ? `${t("stats.runtime.note")} ${t("stats.runtime.missing", { count: stats.unknownRuntime })}`
      : t("stats.runtime.note");

  const scoreColumns = stats.scores.map((count, index) => ({
    key: String(index + 1),
    label: formatNumber(index + 1),
    value: count,
    href: count > 0 ? `/library?rated=${index + 1}` : undefined,
    title: t("stats.point", {
      label: formatNumber(index + 1),
      value: titles(count),
    }),
  }));

  const finished = lastYears(stats.finishedByYear);
  const released = lastYears(stats.releasedByYear);
  const yearColumns = (
    list: typeof finished,
    link: boolean,
  ): Parameters<typeof ColumnChart>[0]["columns"] =>
    list.map(({ year, count }) => ({
      key: String(year),
      label: String(year),
      value: count,
      href: link && count > 0 ? `/library?year=${year}` : undefined,
      title: t("stats.point", { label: year, value: titles(count) }),
    }));

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

  const heat = heatRows(stats.finishedByMonth);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("stats.title")}</h1>
      <p className="text-fg-muted mt-2">{t("stats.description")}</p>

      <section aria-label={t("stats.tiles.label")} className="mt-8">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map(([label, value]) => (
            <div
              key={label}
              className="border-border bg-surface-raised rounded-md border p-4"
            >
              <dd className="text-3xl font-semibold">{value}</dd>
              <dt className="text-fg-muted mt-1 text-sm">{label}</dt>
            </div>
          ))}
        </dl>
        <p className="text-fg-muted mt-3 text-sm">{runtimeNote}</p>
      </section>

      <div className="mt-10 grid gap-x-10 gap-y-12 lg:grid-cols-2">
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

        <Panel id="stats-types" title={t("stats.types.title")}>
          <ProportionBar
            segments={segments}
            format={formatNumber}
            formatShare={(share) => formatNumber(share, { style: "percent" })}
          />
        </Panel>

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
                    <Link
                      to={`/library/${entry.mediaId}`}
                      className={linkClass}
                    >
                      {entry.title}
                    </Link>{" "}
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
      </div>
    </main>
  );
}
