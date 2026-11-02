import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/recommendations";
import { useFormatters } from "~/lib/format";
import { forwardLinkClass, textLinkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  getGenreRecommendations,
  getSagaSuggestions,
} from "~server/db/recommendations";
import {
  viewGenreItems,
  viewSagaSuggestions,
} from "~server/recommendations/view";
import { getDb } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const { t } = getInstance(args.context);
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  const db = await getDb();
  // Both read the library of the person of the verified session, and nobody else's.
  const [genres, sagas] = await Promise.all([
    getGenreRecommendations(db, user.id, locale),
    getSagaSuggestions(db, user.id),
  ]);
  return {
    title: t("app.pageTitle", { title: t("recommendations.title") }),
    likedGenres: genres.likedGenres,
    genres: viewGenreItems(genres.items),
    sagas: viewSagaSuggestions(sagas, locale),
  };
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

// The kinds that have a name of their own in the texts; a game or another format has none.
const kinds = new Set(["anime", "movie", "series", "book", "manga"]);

export default function Recommendations({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatList } = useFormatters();
  const { genres, sagas, likedGenres } = loaderData;

  const kindLabel = (format: string) =>
    kinds.has(format)
      ? t(
          `media.kinds.${format as "anime" | "movie" | "series" | "book" | "manga"}`,
        )
      : null;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("recommendations.title")}</h1>
      <p className="text-fg-muted mt-2">{t("recommendations.description")}</p>

      <section aria-labelledby="recommendations-genres" className="mt-8">
        <h2 id="recommendations-genres" className="text-xl font-semibold">
          {t("recommendations.genres.title")}
        </h2>
        <p className="text-fg-muted mt-1">
          {t("recommendations.genres.description")}
        </p>
        {genres.length > 0 ? (
          <ul className="mt-4 space-y-4">
            {genres.map((item) => (
              <li
                key={item.mediaId}
                className="border-border bg-surface-raised rounded-md border p-4"
              >
                <p className="font-semibold">
                  <Link to={item.href} className={textLinkClass}>
                    {item.title}
                  </Link>
                  <span className="text-fg-muted ml-2 font-normal">
                    {kindLabel(item.type)}
                    {item.year
                      ? ` ${t("search.year", { year: item.year })}`
                      : ""}
                  </span>
                </p>
                <p className="text-fg-muted mt-1 text-sm">
                  {t("recommendations.genres.because", {
                    genres: formatList(
                      item.because.map((genre) => t(`genres.${genre}`)),
                    ),
                  })}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4">
            {likedGenres === 0
              ? t("recommendations.genres.noTaste")
              : t("recommendations.genres.empty")}{" "}
            <Link to="/search" className={forwardLinkClass}>
              {t("recommendations.searchLink")}
            </Link>
          </p>
        )}
      </section>

      {sagas.length > 0 ? (
        <section aria-labelledby="recommendations-sagas" className="mt-10">
          <h2 id="recommendations-sagas" className="text-xl font-semibold">
            {t("recommendations.sagas.title")}
          </h2>
          <p className="text-fg-muted mt-1">
            {t("recommendations.sagas.description")}
          </p>
          <ul className="mt-4 space-y-4">
            {sagas.map((saga) => (
              <li
                key={saga.slug}
                className="border-border bg-surface-raised rounded-md border p-4"
              >
                <p className="font-semibold">
                  <Link to={`/sagas/${saga.slug}`} className={textLinkClass}>
                    {saga.title}
                  </Link>
                </p>
                <ul className="mt-2 space-y-1">
                  {saga.items.map((work) => (
                    <li key={work.qid}>
                      {work.href ? (
                        <Link to={work.href} className={textLinkClass}>
                          {work.label}
                        </Link>
                      ) : (
                        work.label
                      )}
                      <span className="text-fg-muted ml-2 text-sm">
                        {kindLabel(work.format)}
                        {work.year
                          ? ` ${t("search.year", { year: work.year })}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {saga.more > 0 ? (
                  <p className="text-fg-muted mt-2 text-sm">
                    {t("recommendations.sagas.more", { count: saga.more })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-fg-muted mt-4 text-sm">{t("saga.notHeld")}</p>
        </section>
      ) : null}
    </main>
  );
}
