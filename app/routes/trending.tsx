import { useTranslation } from "react-i18next";

import { PosterGrid, type PosterGridEntry } from "~/components/PosterGrid";
import { TrendingFilters } from "~/components/trending/TrendingFilters";
import { useFormatters } from "~/lib/format";
import { getInstance, getLocale } from "~/middleware/i18next";
import type { Route } from "./+types/trending";
import { minPeople, type FavoriteTitle } from "~server/db/site-favorites";
import type { MediaKind } from "~server/providers/types";
import { privateRouteHeaders } from "~server/http/cache";
import { imageSrc } from "~server/images/sources";
import { mediaPath, openPath } from "~server/media/slug";
import {
  getMediaProviders,
  getTrendingCache,
  getDb,
} from "~server/runtime-env";
import { loadTrendingPage } from "~server/trending/page";
import {
  parseTrendingView,
  pastYears,
  periodOf,
  trendingPath,
  type TrendingView,
} from "~server/trending/query";

/** A title of the lists of the site, as the page draws it. */
const siteCard = (item: FavoriteTitle) => ({
  href: mediaPath(item.type as MediaKind, item.title, item.mediaId),
  title: item.title,
  poster: imageSrc(item.imageUrl, "w185"),
  people: item.people,
  average: item.average,
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = getLocale(context) === "en" ? "en" : "es";
  const { t } = getInstance(context);
  const now = new Date();
  const view = parseTrendingView(new URL(request.url).searchParams, now);

  const page = await loadTrendingPage({
    db: await getDb(),
    cache: getTrendingCache(),
    providers: getMediaProviders(),
    type: view.type,
    period: periodOf(view.period, now),
    locale,
    signal: request.signal,
  });

  const { worldwide, favorites } = page;
  return {
    pageTitle: t("app.pageTitle", { title: t("trending.title") }),
    description: t("trending.description"),
    // A made-up value in the address shows the usual page, and this points search engines at it.
    canonicalUrl: `${new URL(request.url).origin}${trendingPath(view)}`,
    view,
    pastYears: pastYears(now),
    minPeople,
    site: {
      mostAdded: favorites.mostAdded.map(siteCard),
      mostCompleted: favorites.mostCompleted.map(siteCard),
      bestRated: favorites.bestRated.map(siteCard),
    },
    worldwide:
      worldwide.status === "ok"
        ? {
            status: worldwide.status,
            source: worldwide.source,
            titles: worldwide.titles.map((item) => ({
              // A title we hold opens its own page; one we do not is saved by a person with a
              // session, and a visitor is sent to sign in first (ADR-035).
              href: openPath(item.provider, item.externalId),
              title: item.title,
              year: item.year,
              poster: imageSrc(item.imageUrl, "w185"),
            })),
          }
        : { status: worldwide.status },
  };
}

// The header of the page shows who is signed in, so no shared cache keeps the page. The lists
// themselves are kept at the edge by the loader.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return [
    { title: loaderData.pageTitle },
    { name: "description", content: loaderData.description },
    { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
  ];
}

const pathFor = (view: { type: string; period: string }) =>
  trendingPath(view as TrendingView);

export default function TrendingPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatNumber } = useFormatters();
  const { view, site, worldwide } = loaderData;

  const entries = (
    items: (typeof site)["mostAdded"],
    note: (item: (typeof items)[number]) => string,
  ): PosterGridEntry[] =>
    items.map((item) => ({
      href: item.href,
      title: item.title,
      score: null,
      poster: item.poster,
      note: note(item),
    }));
  const people = (item: { people: number }) =>
    t("trending.people", { count: item.people });
  const rated = (item: { people: number; average: number | null }) =>
    t("trending.ratedNote", {
      count: item.people,
      average: formatNumber(item.average ?? 0, { maximumFractionDigits: 1 }),
    });

  const lists = [
    { key: "mostAdded", items: entries(site.mostAdded, people) },
    { key: "mostCompleted", items: entries(site.mostCompleted, people) },
    { key: "bestRated", items: entries(site.bestRated, rated) },
  ] as const;
  const nothingYet = lists.every((list) => list.items.length === 0);

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("trending.title")}</h1>
      <p className="text-fg-muted mt-2">{t("trending.intro")}</p>

      <TrendingFilters
        type={view.type}
        period={view.period}
        pastYears={loaderData.pastYears}
        pathFor={pathFor}
      />

      <section aria-labelledby="trending-site" className="mt-8">
        <h2 id="trending-site" className="text-2xl font-bold">
          {t("trending.site.title")}
        </h2>
        <p className="text-fg-muted mt-1">
          {t("trending.site.intro", { count: loaderData.minPeople })}
        </p>
        {nothingYet ? (
          <p className="mt-4">
            {t("trending.site.empty", { count: loaderData.minPeople })}
          </p>
        ) : (
          lists.map((list) => (
            <div key={list.key} className="mt-6">
              <h3 className="text-xl font-semibold">
                {t(`trending.site.${list.key}`)}
              </h3>
              {list.items.length === 0 ? (
                <p className="text-fg-muted mt-2">
                  {t("trending.site.listEmpty", {
                    count: loaderData.minPeople,
                  })}
                </p>
              ) : (
                <PosterGrid entries={list.items} ordered />
              )}
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="trending-world" className="mt-12">
        <h2 id="trending-world" className="text-2xl font-bold">
          {t("trending.worldwide.title")}
        </h2>
        {worldwide.status === "ok" ? (
          <>
            <p className="text-fg-muted mt-1">
              {t("trending.worldwide.intro", { source: worldwide.source.name })}
            </p>
            {worldwide.titles.length === 0 ? (
              <p className="mt-4">{t("trending.worldwide.empty")}</p>
            ) : (
              <PosterGrid
                ordered
                entries={worldwide.titles.map((item) => ({
                  href: item.href,
                  title: item.title,
                  score: null,
                  poster: item.poster,
                  // `/media/open` saves the title and redirects, so it needs a full page load.
                  wholePage: true,
                  ...(item.year ? { note: String(item.year) } : {}),
                }))}
              />
            )}
            <div className="mt-6 space-y-2">
              <a
                href={worldwide.source.url}
                rel="noreferrer"
                className="inline-flex min-h-10 items-center"
              >
                <img
                  src={worldwide.source.logo}
                  alt={t("credits.tmdb.logoAlt")}
                  width={245}
                  height={18}
                  className="h-auto max-w-full"
                />
              </a>
              {/* TMDB requires this exact wording, so it stays in English in both languages. */}
              <p lang="en" className="text-fg-muted text-sm">
                {worldwide.source.notice}
              </p>
            </div>
          </>
        ) : (
          <p className="mt-4">
            {worldwide.status === "unavailable"
              ? t("trending.worldwide.unavailable")
              : t("trending.worldwide.unsupported")}
          </p>
        )}
      </section>
    </main>
  );
}
