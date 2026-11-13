import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data } from "react-router";

import type { Route } from "./+types/admin.stats.favorites";
import { AdminNav } from "~/components/AdminNav";
import { ClerkSession } from "~/components/ClerkSession";
import { FavoritesPanel } from "~/components/admin/FavoritesPanel";
import { StatsNav } from "~/components/admin/StatsNav";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireRole } from "~server/auth/require";
import { minPeople, type FavoriteTitle } from "~server/db/site-favorites";
import { privateRouteHeaders } from "~server/http/cache";
import { mediaPath } from "~server/media/slug";
import type { MediaKind } from "~server/providers/types";
import {
  getClerkKeys,
  getDb,
  getMediaProviders,
  getTrendingCache,
} from "~server/runtime-env";
import { loadTrendingPage } from "~server/trending/page";
import { parseTrendingView, pastYears, periodOf } from "~server/trending/query";

/** A title of the lists of the site, as the panel draws it. */
const siteRow = (item: FavoriteTitle) => ({
  key: item.mediaId,
  href: mediaPath(item.type as MediaKind, item.title, item.mediaId),
  title: item.title,
  people: item.people,
  average: item.average,
});

/**
 * The favorites of the site and of the world for a type and a period (SAG-26, SAG-23). It asks the
 * same function as `/trending`, with the same copy at the edge, so it adds no work to the database
 * and it holds the same rule: only public things, and a title needs at least `minPeople` people.
 */
export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  const now = new Date();
  const view = parseTrendingView(new URL(args.request.url).searchParams, now);
  const { favorites, worldwide } = await loadTrendingPage({
    db: await getDb(),
    cache: getTrendingCache(),
    providers: getMediaProviders(),
    type: view.type,
    period: periodOf(view.period, now),
    locale,
    signal: args.request.signal,
  });

  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.stats.nav.favorites") }),
    publishableKey: keys.publishableKey,
    view,
    pastYears: pastYears(now),
    minPeople,
    site: {
      mostAdded: favorites.mostAdded.map(siteRow),
      mostCompleted: favorites.mostCompleted.map(siteRow),
      bestRated: favorites.bestRated.map(siteRow),
    },
    worldwide:
      worldwide.status === "ok"
        ? {
            status: worldwide.status,
            source: worldwide.source.name,
            titles: worldwide.titles.map((item) => ({
              key: `${item.provider}:${item.externalId}`,
              title: item.title,
              year: item.year,
            })),
          }
        : { status: worldwide.status },
  }));
}

// The numbers of the administration are never kept by a shared cache, and not indexed.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function AdminStatsFavorites({
  loaderData,
}: Route.ComponentProps) {
  const { t } = useTranslation();

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <AdminNav current="stats" />
        <h1 className="text-3xl font-bold">{t("admin.stats.title")}</h1>
        <p className="text-fg-muted mt-2">{t("admin.stats.description")}</p>
        <StatsNav current="favorites" />
        <FavoritesPanel
          view={loaderData.view}
          pastYears={loaderData.pastYears}
          minPeople={loaderData.minPeople}
          site={loaderData.site}
          worldwide={loaderData.worldwide}
        />
      </main>
    </ClerkSession>
  );
}
