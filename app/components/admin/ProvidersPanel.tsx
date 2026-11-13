import { useTranslation } from "react-i18next";

import { DaysNav } from "~/components/admin/DaysNav";
import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart, type Column } from "~/components/charts/ColumnChart";
import { ProportionBar, type Segment } from "~/components/charts/ProportionBar";
import { useFormatters } from "~/lib/format";
import type { AdminProviders } from "~/routes/admin.stats.providers";

const tones: Segment["tone"][] = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

/** The names of the providers as their own sites write them; any other is shown as it is. */
const providerNames: Record<string, string> = {
  tmdb: "TMDB",
  mangadex: "MangaDex",
  "open-library": "Open Library",
  tvmaze: "TVmaze",
  wikidata: "Wikidata",
};

const heading = "mt-10 text-xl font-semibold";
const lead = "text-fg-muted mt-1 mb-4 text-sm";

/** The providers: how many calls were made to each, how they ended and how long they took. */
export function ProvidersPanel({
  providers,
  options,
}: {
  providers: AdminProviders;
  options: readonly number[];
}) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  const number = (value: number) => formatNumber(value);
  const dateOf = (day: string) =>
    formatDate(new Date(`${day}T00:00:00Z`), { dateStyle: "medium" });
  const percent = (share: number) =>
    formatNumber(share, { style: "percent", maximumFractionDigits: 0 });
  const milliseconds = (value: number | null) =>
    value === null
      ? t("admin.stats.providers.none")
      : formatNumber(Math.round(value), { style: "unit", unit: "millisecond" });
  const share = (part: number, whole: number) =>
    whole > 0 ? percent(part / whole) : t("admin.stats.providers.none");
  const nameOf = (provider: string) => providerNames[provider] ?? provider;

  const { totals } = providers;
  const outcomes = Object.keys(
    totals.outcomes,
  ) as (keyof typeof totals.outcomes)[];
  const tiles = [
    ["calls", number(totals.calls)],
    ["failed", share(totals.failed, totals.calls)],
    ["latency", milliseconds(totals.latencyAvgMs)],
    ["requests", number(totals.requests)],
  ] as const;

  const columns: Column[] = providers.perDay.map((row) => ({
    key: row.day,
    label: String(Number(row.day.slice(8, 10))),
    value: row.failed,
    describedAs: `${dateOf(row.day)}: ${number(row.failed)}`,
    title: t("admin.stats.providers.perDay.columnTitle", {
      date: dateOf(row.day),
      count: row.failed,
    }),
  }));

  return (
    <section aria-labelledby="admin-providers" className="mt-8">
      <h2 id="admin-providers" className="sr-only">
        {t("admin.stats.nav.providers")}
      </h2>

      <DaysNav
        days={providers.days}
        options={options}
        path="/admin/stats/providers"
      />
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.common.rangeToday", {
          from: dateOf(providers.from),
          to: dateOf(providers.to),
        })}
      </p>
      <p className="text-fg-muted mt-1 text-sm">
        {providers.startedOn === null
          ? t("admin.stats.providers.notStarted")
          : providers.startedOn > providers.from
            ? t("admin.stats.providers.startedOn", {
                date: dateOf(providers.startedOn),
              })
            : null}
      </p>

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
              {t(`admin.stats.providers.tiles.${key}`)}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.providers.note")}
      </p>

      <h3 className={heading}>{t("admin.stats.providers.table.heading")}</h3>
      <p className={lead}>{t("admin.stats.providers.table.description")}</p>
      {providers.providers.length === 0 ? (
        <p className="text-fg-muted text-sm">{t("admin.stats.common.empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {providers.providers.map((one) => (
            <li
              key={one.provider}
              className="border-border bg-surface-raised rounded-md border p-4"
            >
              <h4 className="font-semibold">{nameOf(one.provider)}</h4>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    ["calls", number(one.calls)],
                    ["failed", share(one.failed, one.calls)],
                    ["latency", milliseconds(one.latencyAvgMs)],
                    ["requests", number(one.requests)],
                    ["peak", number(one.peakDayRequests)],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-fg-muted">
                      {t(`admin.stats.providers.table.${key}`)}
                    </dt>
                    <dd className="text-right tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <h3 className={heading}>{t("admin.stats.providers.outcomes.heading")}</h3>
      <p className={lead}>{t("admin.stats.providers.outcomes.description")}</p>
      {totals.calls === 0 ? (
        <p className="text-fg-muted text-sm">{t("admin.stats.common.empty")}</p>
      ) : (
        <ProportionBar
          segments={outcomes.map((key, index) => ({
            key,
            label: t(`admin.stats.providers.outcomes.${key}`),
            value: totals.outcomes[key],
            tone: tones[index] ?? "chart-other",
          }))}
          format={number}
          formatShare={percent}
        />
      )}

      <h3 className={heading}>{t("admin.stats.providers.perDay.heading")}</h3>
      <p className={lead}>{t("admin.stats.providers.perDay.description")}</p>
      <ColumnChart columns={columns} format={number} />
      <ChartTable
        summary={t("admin.stats.traffic.showNumbers")}
        headers={[
          t("admin.stats.traffic.perDay.day"),
          t("admin.stats.providers.tiles.calls"),
          t("admin.stats.providers.tiles.failed"),
        ]}
        rows={providers.perDay.map((row) => [
          dateOf(row.day),
          number(row.calls),
          number(row.failed),
        ])}
      />
    </section>
  );
}
