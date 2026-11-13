import { useTranslation } from "react-i18next";

import { DaysNav } from "~/components/admin/DaysNav";
import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import type { AdminContent } from "~/routes/admin.stats.content";

const knownTypes = ["movie", "series", "anime", "book", "manga"] as const;

const heading = "mt-10 text-xl font-semibold";
const lead = "text-fg-muted mt-1 mb-4 text-sm";

/** The content of the site: what people search for, titles written by hand and the sagas. */
export function ContentPanel({
  content,
  options,
}: {
  content: AdminContent;
  options: readonly number[];
}) {
  const { t } = useTranslation();
  const { formatNumber, formatDate } = useFormatters();
  const number = (value: number) => formatNumber(value);
  const dateOf = (day: string) =>
    formatDate(new Date(`${day}T00:00:00Z`), { dateStyle: "medium" });
  const typeLabel = (type: string) =>
    (knownTypes as readonly string[]).includes(type)
      ? t(`library.tabs.${type as (typeof knownTypes)[number]}`)
      : type;

  const searchTotal = content.searches.reduce(
    (sum, row) => sum + row.searches,
    0,
  );
  const filled =
    content.works > 0 ? content.worksDescribed / content.works : null;
  const tiles = [
    ["searches", number(searchTotal)],
    ["customTotal", number(content.customTotal)],
    ["sagasPublished", number(content.sagasPublished)],
    ["sagasDraft", number(content.sagasDraft)],
  ] as const;

  return (
    <section aria-labelledby="admin-content" className="mt-8">
      <h2 id="admin-content" className="sr-only">
        {t("admin.stats.nav.content")}
      </h2>

      <DaysNav
        days={content.days}
        options={options}
        path="/admin/stats/content"
      />
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.common.range", {
          from: dateOf(content.from),
          to: dateOf(content.to),
        })}
      </p>

      {content.rolledDays < content.days ? (
        <p className="text-fg-muted mt-1 text-sm">
          {t("admin.stats.common.rolled", {
            rolled: content.rolledDays,
            days: content.days,
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
              {t(`admin.stats.content.tiles.${key}`)}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <h3 className={heading}>{t("admin.stats.content.searches.heading")}</h3>
      <p className={lead}>{t("admin.stats.content.searches.description")}</p>
      {content.searches.length === 0 ? (
        <p className="text-fg-muted text-sm">{t("admin.stats.common.empty")}</p>
      ) : (
        <RowBars
          rows={content.searches.map((row) => ({
            key: row.type,
            label: typeLabel(row.type),
            value: row.searches,
          }))}
          format={number}
        />
      )}
      <p className="text-fg-muted mt-3 text-sm">
        {t("admin.stats.content.searches.noResult")}
      </p>

      <h3 className={heading}>{t("admin.stats.content.custom.heading")}</h3>
      <p className={lead}>{t("admin.stats.content.custom.description")}</p>
      <p>
        {t("admin.stats.content.custom.summary", {
          total: number(content.customTotal),
          recent: number(content.customNew),
        })}
      </p>

      <h3 className={heading}>{t("admin.stats.content.sagas.heading")}</h3>
      <p className={lead}>{t("admin.stats.content.sagas.description")}</p>
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
        {(
          [
            ["published", content.sagasPublished],
            ["draft", content.sagasDraft],
            ["empty", content.sagasEmpty],
            ["works", content.works],
            ["described", content.worksDescribed],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg">{t(`admin.stats.content.sagas.${key}`)}</dt>
            <dd className="text-fg-muted text-right tabular-nums">
              {number(value)}
            </dd>
          </div>
        ))}
      </dl>
      {filled !== null ? (
        <p className="text-fg-muted mt-3 text-sm">
          {t("admin.stats.content.sagas.filled", {
            share: formatNumber(filled, {
              style: "percent",
              maximumFractionDigits: 0,
            }),
          })}
        </p>
      ) : null}
    </section>
  );
}
