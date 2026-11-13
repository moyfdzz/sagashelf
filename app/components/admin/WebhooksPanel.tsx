import { useTranslation } from "react-i18next";

import { DaysNav } from "~/components/admin/DaysNav";
import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart, type Column } from "~/components/charts/ColumnChart";
import { ProportionBar, type Segment } from "~/components/charts/ProportionBar";
import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { AdminWebhooks } from "~/routes/admin.stats.webhooks";

// The order of the results and of the statuses is the one the server gives, and the colors follow it.
const tones: Segment["tone"][] = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];
const rejectReasons = [
  "taken",
  "reserved_username",
  "invalid_username",
  "no_verified_email",
  "invalid_email",
] as const;
const disableReasons = [
  "unauthorized",
  "not_found",
  "too_many_failures",
] as const;

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

/** The webhooks of the site: what Clerk sent us, what we delivered to the endpoints, and the endpoints. */
export function WebhooksPanel({
  webhooks,
  options,
}: {
  webhooks: AdminWebhooks;
  options: readonly number[];
}) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  const number = (value: number) => formatNumber(value);
  const dateOf = (day: string) =>
    formatDate(new Date(`${day}T00:00:00Z`), { dateStyle: "medium" });
  const milliseconds = (value: number) =>
    formatNumber(Math.round(value), { style: "unit", unit: "millisecond" });
  const percent = (share: number) =>
    formatNumber(share, { style: "percent", maximumFractionDigits: 0 });

  const results = Object.keys(
    webhooks.attempts,
  ) as (keyof AdminWebhooks["attempts"])[];
  const statuses = Object.keys(
    webhooks.events,
  ) as (keyof AdminWebhooks["events"])[];
  const rejected = webhooks.clerk.rejected.reduce((sum, r) => sum + r.count, 0);
  const attempts = results.reduce(
    (sum, key) => sum + webhooks.attempts[key],
    0,
  );
  const failed = attempts - webhooks.attempts.ok;
  const tiles = [
    ["clerkProcessed", number(webhooks.clerk.processed)],
    ["clerkRejected", number(rejected)],
    ["attempts", number(attempts)],
    ["failed", number(failed)],
  ] as const;

  const columns: Column[] = webhooks.perDay.map((row) => ({
    key: row.day,
    label: String(Number(row.day.slice(8, 10))),
    value: row.failed,
    describedAs: `${dateOf(row.day)}: ${number(row.failed)}`,
    title: t("admin.stats.webhooks.perDay.columnTitle", {
      date: dateOf(row.day),
      count: row.failed,
    }),
  }));

  return (
    <section aria-labelledby="admin-webhooks" className="mt-8">
      <h2 id="admin-webhooks" className="sr-only">
        {t("admin.stats.nav.webhooks")}
      </h2>

      <DaysNav
        days={webhooks.days}
        options={options}
        path="/admin/stats/webhooks"
      />
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.common.rangeToday", {
          from: dateOf(webhooks.from),
          to: dateOf(webhooks.to),
        })}
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
              {t(`admin.stats.webhooks.tiles.${key}`)}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <h3 className={heading}>{t("admin.stats.webhooks.clerk.heading")}</h3>
      <p className={lead}>
        {t("admin.stats.webhooks.clerk.description", {
          count: webhooks.clerk.processed,
        })}
      </p>
      <h4 className="mb-3 font-semibold">
        {t("admin.stats.webhooks.clerk.rejected")}
      </h4>
      {webhooks.clerk.rejected.length === 0 ? (
        <p className="text-fg-muted text-sm">
          {t("admin.stats.webhooks.clerk.none")}
        </p>
      ) : (
        <RowBars
          rows={webhooks.clerk.rejected.map((row) => ({
            key: row.reason,
            label: pick(row.reason, rejectReasons, (key) =>
              t(`admin.stats.webhooks.clerk.reasons.${key}`),
            ),
            value: row.count,
          }))}
          format={number}
        />
      )}
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.webhooks.clerk.note")}
      </p>

      <h3 className={heading}>
        {t("admin.stats.webhooks.deliveries.heading")}
      </h3>
      <p className={lead}>{t("admin.stats.webhooks.deliveries.description")}</p>
      {attempts === 0 ? (
        <p className="text-fg-muted text-sm">{t("admin.stats.common.empty")}</p>
      ) : (
        <ProportionBar
          segments={results.map((key, index) => ({
            key,
            label: t(`admin.stats.webhooks.deliveries.results.${key}`),
            value: webhooks.attempts[key],
            tone: tones[index] ?? "chart-other",
          }))}
          format={number}
          formatShare={percent}
        />
      )}
      {webhooks.latencyAvgMs !== null && webhooks.latencyP95Ms !== null ? (
        <p className="text-fg-muted mt-3 text-sm">
          {t("admin.stats.webhooks.deliveries.latency", {
            average: milliseconds(webhooks.latencyAvgMs),
            slowest: milliseconds(webhooks.latencyP95Ms),
          })}
        </p>
      ) : null}

      <h4 className="mt-6 mb-3 font-semibold">
        {t("admin.stats.webhooks.deliveries.events")}
      </h4>
      <RowBars
        rows={statuses.map((key) => ({
          key,
          label: t(`admin.stats.webhooks.deliveries.status.${key}`),
          value: webhooks.events[key],
        }))}
        format={number}
      />
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.webhooks.deliveries.pendingNow", {
          count: webhooks.pendingNow,
        })}
      </p>

      <h4 className="mt-6 mb-1 font-semibold">
        {t("admin.stats.webhooks.perDay.heading")}
      </h4>
      <p className={lead}>{t("admin.stats.webhooks.perDay.description")}</p>
      <ColumnChart columns={columns} format={number} />
      <ChartTable
        summary={t("admin.stats.traffic.showNumbers")}
        headers={[
          t("admin.stats.traffic.perDay.day"),
          t("admin.stats.webhooks.tiles.attempts"),
          t("admin.stats.webhooks.tiles.failed"),
        ]}
        rows={webhooks.perDay.map((row) => [
          dateOf(row.day),
          number(row.attempts),
          number(row.failed),
        ])}
      />

      <h3 className={heading}>{t("admin.stats.webhooks.endpoints.heading")}</h3>
      <p className={lead}>{t("admin.stats.webhooks.endpoints.description")}</p>
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
        <div className="contents">
          <dt className="text-fg">
            {t("admin.stats.webhooks.endpoints.total")}
          </dt>
          <dd className="text-fg-muted text-right tabular-nums">
            {number(webhooks.endpoints.total)}
          </dd>
        </div>
        <div className="contents">
          <dt className="text-fg">
            {t("admin.stats.webhooks.endpoints.enabled")}
          </dt>
          <dd className="text-fg-muted text-right tabular-nums">
            {number(webhooks.endpoints.enabled)}
          </dd>
        </div>
        {webhooks.endpoints.disabled.map((row) => (
          <div key={row.reason} className="contents">
            <dt className="text-fg">
              {pick(row.reason, disableReasons, (key) =>
                t(`admin.stats.webhooks.endpoints.reasons.${key}`),
              )}
            </dt>
            <dd className="text-fg-muted text-right tabular-nums">
              {number(row.count)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
