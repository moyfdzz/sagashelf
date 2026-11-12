import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";

import type { Route } from "./+types/library";
import {
  forwardLinkClass,
  linkClass,
  secondaryLinkClass,
  segmentClass,
  segmentedGroupClass,
  tabClass,
} from "~/lib/ui";
import { FiltersForm } from "~/components/library-list/FiltersForm";
import { Sections } from "~/components/library-list/Sections";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { listLibrary } from "~server/db/library";
import { imageSrc } from "~server/images/sources";
import {
  libraryQuerySchema,
  libraryTypes,
  libraryViews,
  searchMaxLength,
  visibilityLevels,
  sortOptions,
  type LibraryStatus,
} from "~server/library/schema";
import {
  chooseView,
  readViewCookie,
  viewCookieHeader,
} from "~server/library/view";
import { libraryPath } from "~server/library/path";
import { getDb } from "~server/runtime-env";
import { mergePrivateHeaders } from "~server/http/cache";

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const query = libraryQuerySchema.parse(
    Object.fromEntries(new URL(args.request.url).searchParams),
  );
  const view = chooseView(query.view, readViewCookie(args.request));

  const library = await listLibrary(
    await getDb(),
    user.id,
    query,
    getLocale(args.context) === "en" ? "en" : "es",
  );
  const { t } = getInstance(args.context);

  const body = {
    title: t("library.title"),
    query,
    view,
    counts: library.counts,
    sections: library.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({
        ...row,
        poster: imageSrc(row.imageUrl, "w185"),
      })),
    })),
  };
  // A view named in the address is remembered for the next visit.
  if (query.view) {
    const secure = new URL(args.request.url).protocol === "https:";
    return data(body, {
      headers: { "Set-Cookie": viewCookieHeader(query.view, secure) },
    });
  }
  return body;
}

// A page with a person's data is never kept by a shared cache.
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** What the page is given, for the pieces of the page that draw it. */
export type LibraryData = Route.ComponentProps["loaderData"];

/** A change to the address of the library, as `libraryPath` takes it. */
export type LibraryPathChange = Parameters<typeof libraryPath>[2];

// The lists and limits of the library live in server/, which a component may not import.
const filterOptions = { searchMaxLength, visibilityLevels, sortOptions };

export default function Library({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { query, view, counts, sections } = loaderData;
  const pages = Object.fromEntries(
    sections.map((section) => [section.status, section.page]),
  ) as Record<LibraryStatus, number>;
  const searching = Boolean(
    query.q ||
    query.year ||
    query.score ||
    query.rated ||
    query.genre ||
    query.visibility,
  );
  const total = query.type ? counts[query.type] : counts.all;

  // The address the library has once one thing changes, keeping the rest of what is chosen.
  const pathTo = (change: LibraryPathChange) =>
    libraryPath(query, pages, change);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="text-3xl font-bold">{t("library.title")}</h1>
        {/* A page of the session: a plain anchor, which loads a whole new document (ADR-018). */}
        <a href="/lists" className={forwardLinkClass}>
          {t("library.listsLink")}
        </a>
      </div>
      <p className="text-fg-muted mt-2">{t("library.description")}</p>

      <nav aria-label={t("library.tabs.label")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {[null, ...libraryTypes].map((type) => {
            const active = (query.type ?? null) === type;
            return (
              <li key={type ?? "all"}>
                <Link
                  to={pathTo({ type })}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {t(`library.tabs.${type ?? "all"}`)}{" "}
                  <span className="font-normal">
                    {t("library.badge", {
                      count: type ? counts[type] : counts.all,
                    })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <FiltersForm
        query={query}
        pathTo={pathTo}
        searching={searching}
        options={filterOptions}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-fg-muted">
          {t("library.count", { count: total })}
        </p>
        <nav aria-label={t("library.views.label")}>
          <ul className={segmentedGroupClass}>
            {libraryViews.map((option) => (
              <li key={option}>
                <Link
                  to={pathTo({ view: option })}
                  aria-current={view === option ? "true" : undefined}
                  className={segmentClass(view === option)}
                >
                  {t(`library.views.${option}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {total === 0 ? (
        <div className="mt-4">
          <p>
            {searching
              ? t("library.empty.noMatch")
              : query.type
                ? t(`library.empty.byType.${query.type}`)
                : t("library.empty.none")}
          </p>
          {searching ? (
            <p className="mt-3">
              <Link to={pathTo({ clear: true })} className={secondaryLinkClass}>
                {t("library.filters.clear")}
              </Link>
            </p>
          ) : query.type ? null : (
            <p className="mt-3">
              <Link to="/search" className={linkClass}>
                {t("library.empty.search")}
              </Link>
            </p>
          )}
        </div>
      ) : (
        <Sections
          sections={sections}
          query={query}
          view={view}
          searching={searching}
          pathTo={pathTo}
        />
      )}
    </main>
  );
}
