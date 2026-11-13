import { useTranslation } from "react-i18next";

import { RowBars } from "~/components/charts/RowBars";
import { useFormatters } from "~/lib/format";
import { tabClass } from "~/lib/ui";

const types = ["movie", "series", "anime", "book", "manga"] as const;
const recent = ["week", "month", "year"] as const;

type SiteRow = {
  key: string;
  href: string;
  title: string;
  people: number;
  average: number | null;
};

type Worldwide =
  | {
      status: "ok";
      source: string;
      titles: { key: string; title: string; year: number | null }[];
    }
  | { status: "unavailable" | "unsupported" };

const heading = "mt-10 text-xl font-semibold";

/** The year after a title, in parentheses (a function, so the text is not a literal in the markup). */
const yearNote = (year: number) => ` (${year})`;

/** The address of a view of this page; the default one is the bare address. */
const pathFor = (type: string, period: string) => {
  const params = new URLSearchParams();
  if (type !== "movie") params.set("type", type);
  if (period !== "week") params.set("period", period);
  const query = params.toString();
  return query ? `/admin/stats/favorites?${query}` : "/admin/stats/favorites";
};

/**
 * The titles people of the site add, complete and rate most, next to what the world is watching
 * (SAG-26). The lists are the ones of `/trending`: only public things, and a title needs at least
 * `minPeople` different people, so an administrator cannot point at one person either.
 */
export function FavoritesPanel({
  view,
  pastYears,
  minPeople,
  site,
  worldwide,
}: {
  view: { type: string; period: string };
  pastYears: readonly number[];
  minPeople: number;
  site: {
    mostAdded: SiteRow[];
    mostCompleted: SiteRow[];
    bestRated: SiteRow[];
  };
  worldwide: Worldwide;
}) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const periods = [...recent, ...pastYears.map(String)];

  const lists = [
    ["mostAdded", site.mostAdded],
    ["mostCompleted", site.mostCompleted],
    ["bestRated", site.bestRated],
  ] as const;

  return (
    <section aria-labelledby="admin-favorites" className="mt-8">
      <h2 id="admin-favorites" className="sr-only">
        {t("admin.stats.nav.favorites")}
      </h2>

      <nav aria-label={t("library.tabs.label")}>
        <ul className="flex flex-wrap gap-2">
          {types.map((type) => (
            <li key={type}>
              <a
                href={pathFor(type, view.period)}
                aria-current={type === view.type ? "page" : undefined}
                className={tabClass(type === view.type)}
              >
                {t(`library.tabs.${type}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label={t("trending.period.label")} className="mt-3">
        <ul className="flex flex-wrap gap-2">
          {periods.map((period) => (
            <li key={period}>
              <a
                href={pathFor(view.type, period)}
                aria-current={period === view.period ? "page" : undefined}
                className={tabClass(period === view.period)}
              >
                {period === "week" || period === "month" || period === "year"
                  ? t(`trending.period.${period}`)
                  : period}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <h3 className={heading}>{t("trending.site.title")}</h3>
      <p className="text-fg-muted mt-1 text-sm">
        {t("trending.site.intro", { count: minPeople })}
      </p>
      {lists.map(([key, items]) => (
        <div key={key}>
          <h4 className="mt-6 mb-3 font-semibold">
            {t(`trending.site.${key}`)}
          </h4>
          {items.length === 0 ? (
            <p className="text-fg-muted text-sm">
              {t("trending.site.listEmpty", { count: minPeople })}
            </p>
          ) : (
            <RowBars
              rows={items.map((item) => ({
                key: item.key,
                href: item.href,
                label:
                  key === "bestRated" && item.average !== null
                    ? `${item.title} · ${formatNumber(item.average, {
                        maximumFractionDigits: 1,
                      })}`
                    : item.title,
                value: item.people,
              }))}
              format={(value) => t("trending.people", { count: value })}
            />
          )}
        </div>
      ))}

      <h3 className={heading}>{t("trending.worldwide.title")}</h3>
      {worldwide.status === "ok" ? (
        <>
          <p className="text-fg-muted mt-1 text-sm">
            {t("trending.worldwide.intro", { source: worldwide.source })}
          </p>
          {worldwide.titles.length === 0 ? (
            <p className="mt-4">{t("trending.worldwide.empty")}</p>
          ) : (
            <ol className="mt-4 max-w-md list-decimal space-y-1 pl-6 text-sm">
              {worldwide.titles.map((item) => (
                <li key={item.key}>
                  {item.title}
                  {item.year !== null ? (
                    <span className="text-fg-muted">{yearNote(item.year)}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="text-fg-muted mt-1 text-sm">
          {worldwide.status === "unavailable"
            ? t("trending.worldwide.unavailable")
            : t("trending.worldwide.unsupported")}
        </p>
      )}
    </section>
  );
}
