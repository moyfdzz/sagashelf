import { useTranslation } from "react-i18next";

import { DaysNav } from "~/components/admin/DaysNav";
import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart, type Column } from "~/components/charts/ColumnChart";
import { ProportionBar, type Segment } from "~/components/charts/ProportionBar";
import { RowBars, type RowBar } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { AdminTraffic } from "~/routes/admin.stats.traffic";

const tones: Segment["tone"][] = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

const knownSources = ["direct", "search", "social", "other"] as const;
const knownDevices = ["mobile", "desktop"] as const;
const knownSteps = ["pageview", "signup", "add_to_library", "follow"] as const;

const heading = "mt-10 text-xl font-semibold";
const lead = "text-fg-muted mt-1 mb-4 text-sm";

/** The label of a value that has a text of its own; any other value is shown as it is. */
function pick<K extends string>(
  value: string,
  known: readonly K[],
  label: (key: K) => string,
): string {
  return (known as readonly string[]).includes(value)
    ? label(value as K)
    : value;
}

/** The traffic of the site: what the rollup of the analytics says, for the window the person chose. */
export function TrafficPanel({
  traffic,
  options,
}: {
  traffic: AdminTraffic;
  options: readonly number[];
}) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  const number = (value: number) => formatNumber(value);
  const percent = (share: number) =>
    formatNumber(share, { style: "percent", maximumFractionDigits: 0 });
  const dateOf = (day: string) =>
    formatDate(new Date(`${day}T00:00:00Z`), { dateStyle: "medium" });

  const perVisit = traffic.visits > 0 ? traffic.pageviews / traffic.visits : 0;
  const secondsPerVisit =
    traffic.visits > 0 ? traffic.engagedMs / traffic.visits / 1000 : 0;
  const time =
    secondsPerVisit >= 60
      ? formatNumber(secondsPerVisit / 60, {
          style: "unit",
          unit: "minute",
          maximumFractionDigits: 1,
        })
      : formatNumber(Math.round(secondsPerVisit), {
          style: "unit",
          unit: "second",
        });
  const tiles = [
    ["pageviews", number(traffic.pageviews)],
    ["visits", number(traffic.visits)],
    ["pagesPerVisit", formatNumber(perVisit, { maximumFractionDigits: 1 })],
    ["timePerVisit", time],
  ] as const;

  const columns: Column[] = traffic.perDay.map((row) => ({
    key: row.day,
    label: String(Number(row.day.slice(8, 10))),
    value: row.pageviews,
    describedAs: `${dateOf(row.day)}: ${number(row.pageviews)}`,
    title: t("admin.stats.traffic.perDay.columnTitle", {
      date: dateOf(row.day),
      count: row.pageviews,
    }),
  }));

  const segments = (
    rows: AdminTraffic["sources"],
    label: (value: string) => string,
  ): Segment[] =>
    rows.map((row, index) => ({
      key: row.value,
      label: label(row.value),
      value: row.events,
      tone: tones[index] ?? "chart-other",
    }));
  // The rest of a day past the cap of the rollup arrives as `(other)`.
  const otherLabel = (value: string) =>
    value === "(other)" ? t("admin.stats.traffic.other") : value;
  const sourceLabel = (value: string) =>
    value === "(other)"
      ? otherLabel(value)
      : pick(value, knownSources, (key) =>
          t(`admin.stats.traffic.sources.${key}`),
        );
  const deviceLabel = (value: string) =>
    value === "(other)"
      ? otherLabel(value)
      : pick(value, knownDevices, (key) =>
          t(`admin.stats.traffic.devices.${key}`),
        );
  const bars = (
    rows: AdminTraffic["sources"],
    label: (value: string) => string,
  ): RowBar[] =>
    rows.map((row) => ({
      key: row.value,
      label: label(row.value),
      value: row.events,
    }));

  const signups = traffic.funnel.find((step) => step.kind === "signup")?.count;
  const rate =
    traffic.visits > 0 && signups !== undefined
      ? (signups / traffic.visits) * 100
      : null;
  const empty = (
    <p className="text-fg-muted text-sm">{t("admin.stats.traffic.empty")}</p>
  );

  return (
    <section aria-labelledby="admin-traffic" className="mt-8">
      <h2 id="admin-traffic" className="sr-only">
        {t("admin.stats.nav.traffic")}
      </h2>

      <DaysNav
        days={traffic.days}
        options={options}
        path="/admin/stats/traffic"
      />
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.traffic.range", {
          from: dateOf(traffic.from),
          to: dateOf(traffic.to),
        })}
      </p>
      {traffic.rolledDays < traffic.days ? (
        <p className="text-fg-muted mt-1 text-sm">
          {t("admin.stats.traffic.rolled", {
            rolled: traffic.rolledDays,
            days: traffic.days,
          })}
        </p>
      ) : null}

      <dl
        aria-label={t("admin.stats.tiles.label")}
        className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {tiles.map(([key, value]) => (
          <div
            key={key}
            className="border-border bg-surface-raised flex flex-col-reverse rounded-md border p-4"
          >
            <dt className="text-fg-muted text-sm">
              {t(`admin.stats.traffic.tiles.${key}`)}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.traffic.visitsNote")}
      </p>

      <h3 className={heading}>{t("admin.stats.traffic.perDay.heading")}</h3>
      <p className={lead}>{t("admin.stats.traffic.perDay.description")}</p>
      <ColumnChart columns={columns} format={number} />
      <ChartTable
        summary={t("admin.stats.traffic.showNumbers")}
        headers={[
          t("admin.stats.traffic.perDay.day"),
          t("admin.stats.traffic.tiles.pageviews"),
          t("admin.stats.traffic.tiles.visits"),
        ]}
        rows={traffic.perDay.map((row) => [
          dateOf(row.day),
          number(row.pageviews),
          number(row.visits),
        ])}
      />

      <h3 className={heading}>{t("admin.stats.traffic.funnel.heading")}</h3>
      <p className={lead}>{t("admin.stats.traffic.funnel.description")}</p>
      <RowBars
        rows={traffic.funnel.map((step) => ({
          key: step.kind,
          label: pick(step.kind, knownSteps, (key) =>
            t(`admin.stats.traffic.funnel.steps.${key}`),
          ),
          value: step.count,
        }))}
        format={number}
      />
      {rate !== null ? (
        <p className="text-fg-muted mt-3 text-sm">
          {t("admin.stats.traffic.funnel.rate", {
            rate: formatNumber(rate, { maximumFractionDigits: 1 }),
          })}
        </p>
      ) : null}

      <h3 className={heading}>{t("admin.stats.traffic.sources.heading")}</h3>
      <p className={lead}>{t("admin.stats.traffic.sources.description")}</p>
      {traffic.sources.length === 0 ? (
        empty
      ) : (
        <ProportionBar
          segments={segments(traffic.sources, sourceLabel)}
          format={number}
          formatShare={percent}
        />
      )}
      {traffic.hosts.length > 0 ? (
        <>
          <h4 className="mt-6 mb-3 font-semibold">
            {t("admin.stats.traffic.sources.hosts")}
          </h4>
          <RowBars rows={bars(traffic.hosts, otherLabel)} format={number} />
        </>
      ) : null}

      <h3 className={heading}>{t("admin.stats.traffic.devices.heading")}</h3>
      <p className={lead}>{t("admin.stats.traffic.devices.description")}</p>
      {traffic.devices.length === 0 ? (
        empty
      ) : (
        <ProportionBar
          segments={segments(traffic.devices, deviceLabel)}
          format={number}
          formatShare={percent}
        />
      )}

      <h3 className={heading}>{t("admin.stats.traffic.pages.heading")}</h3>
      <p className={lead}>{t("admin.stats.traffic.pages.description")}</p>
      {traffic.pages.length === 0 ? (
        empty
      ) : (
        <RowBars rows={bars(traffic.pages, otherLabel)} format={number} />
      )}
    </section>
  );
}
