import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/stats";
import { GenrePanels } from "~/components/stats/GenrePanels";
import { LibraryPanels } from "~/components/stats/LibraryPanels";
import { OverviewPanels } from "~/components/stats/OverviewPanels";
import { StatsTabs } from "~/components/stats/StatsTabs";
import { Tiles } from "~/components/stats/Tiles";
import { TitlePanels } from "~/components/stats/TitlePanels";
import { TypePanels } from "~/components/stats/TypePanels";
import { forwardLinkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { getStats, isStatsType } from "~server/db/stats";
import { getDb } from "~server/runtime-env";
import { privateRouteHeaders } from "~server/http/cache";

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const { t } = getInstance(args.context);
  // The tab asked for (SAG-91). Anything that is not one of the types means all of them.
  const asked = new URL(args.request.url).searchParams.get("type");
  const type = isStatsType(asked) ? asked : null;
  const stats = await getStats(
    await getDb(),
    user.id,
    getLocale(args.context) === "en" ? "en" : "es",
    type ?? undefined,
  );
  return {
    title: t("app.pageTitle", { title: t("stats.title") }),
    type,
    stats,
  };
}

// A page with a person's data is never kept by a shared cache.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** What the page is given, for the pieces of the page that draw it. */
export type StatsPageData = Route.ComponentProps["loaderData"];

// Every link from this page to the library is a plain `<a>`, never the router's `Link`: the library
// has its own security policy, which only a new document gets (ADR-018, SAG-89). A test keeps it so.
export default function Stats({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { stats, type } = loaderData;

  if (stats.entries === 0) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t("stats.title")}</h1>
        {type ? <StatsTabs type={type} /> : null}
        <p className="text-fg-muted mt-4">
          {type ? t(`library.empty.byType.${type}`) : t("stats.empty")}
        </p>
        <p className="mt-4">
          <Link to="/search" className={forwardLinkClass}>
            {t("stats.emptyLink")}
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("stats.title")}</h1>
      <p className="text-fg-muted mt-2">{t("stats.description")}</p>
      <StatsTabs type={type} />
      <Tiles stats={stats} type={type} />

      <div className="mt-10 grid gap-x-10 gap-y-12 lg:grid-cols-2">
        <OverviewPanels stats={stats} type={type} />
        <LibraryPanels stats={stats} type={type} />
        <GenrePanels stats={stats} type={type} />
        <TypePanels stats={stats} type={type} />
        <TitlePanels stats={stats} type={type} />
      </div>
    </main>
  );
}
