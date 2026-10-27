import { useTranslation } from "react-i18next";
import { data, Form, Link } from "react-router";

import type { Route } from "./+types/library";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { listLibrary, type LibraryRow } from "~server/db/library";
import { imageSrc } from "~server/images/sources";
import {
  libraryQuerySchema,
  libraryTypes,
  libraryViews,
  searchMaxLength,
  sectionOrder,
  sortOptions,
  type LibraryQuery,
  type LibraryStatus,
  type LibraryType,
  type LibraryView,
} from "~server/library/schema";
import {
  chooseView,
  readViewCookie,
  viewCookieHeader,
} from "~server/library/view";
import { getDb } from "~server/runtime-env";

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
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  const merged = new Headers({ "Cache-Control": "private, no-store" });
  const cookie = loaderHeaders.get("Set-Cookie");
  if (cookie) merged.set("Set-Cookie", cookie);
  return merged;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

type Change = {
  /** `null` is the tab with every type. */
  type?: LibraryType | null;
  view?: LibraryView;
  /** Drops the search, the filters and the sort. The tab and the view stay. */
  clear?: boolean;
  /** One section goes to another page; the other sections stay where they are. */
  section?: { status: LibraryStatus; page: number };
};

/**
 * The address of the library with the search and the filters kept. Changing the tab or the view
 * sends every section back to its first page; changing the page of one section keeps the rest.
 */
function libraryHref(
  query: LibraryQuery,
  pages: Record<LibraryStatus, number>,
  change: Change = {},
) {
  const params = new URLSearchParams();
  const type = change.type === undefined ? query.type : change.type;
  if (type) params.set("type", type);
  if (!change.clear) {
    if (query.q) params.set("q", query.q);
    if (query.year) params.set("year", String(query.year));
    if (query.score) params.set("score", String(query.score));
    if (query.sort !== "recent") params.set("sort", query.sort);
  }
  const view = change.view ?? query.view;
  if (view) params.set("view", view);
  if (change.section) {
    for (const status of sectionOrder) {
      const page =
        status === change.section.status ? change.section.page : pages[status];
      if (page > 1) params.set(`${status}_page`, String(page));
    }
  }
  const text = params.toString();
  return text ? `/library?${text}` : "/library";
}

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";

const linkClass = "text-accent underline";

type Row = LibraryRow & { poster: string | null };

function Cover({ row, className }: { row: Row; className: string }) {
  const { t } = useTranslation();
  return row.poster ? (
    <img
      src={row.poster}
      alt={t("media.posterAlt", { title: row.title })}
      width={185}
      height={278}
      loading="lazy"
      className={className}
    />
  ) : (
    <div aria-hidden="true" className={`bg-border ${className}`} />
  );
}

function TitleLink({ row }: { row: Row }) {
  const { t } = useTranslation();
  return (
    <>
      {/* A plain link: the entry page has its own security policy, which only a new document
          gets. */}
      <a href={`/library/${row.mediaId}`} className={linkClass}>
        {row.title}
      </a>
      {row.year ? (
        <span className="text-fg-muted font-normal">
          {" "}
          {t("search.year", { year: row.year })}
        </span>
      ) : null}
    </>
  );
}

function Entries({ rows, view }: { rows: Row[]; view: LibraryView }) {
  const { t } = useTranslation();

  if (view === "titles") {
    return (
      <ul className="mt-3 space-y-1">
        {rows.map((row) => (
          <li key={row.mediaId} className="font-semibold">
            <TitleLink row={row} />
          </li>
        ))}
      </ul>
    );
  }

  if (view === "grid") {
    return (
      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((row) => (
          <li key={row.mediaId} className="min-w-0">
            <Cover
              row={row}
              className="aspect-[2/3] w-full rounded object-cover"
            />
            <p className="mt-2 text-sm font-semibold break-words">
              <TitleLink row={row} />
            </p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-3 space-y-3">
      {rows.map((row) => (
        <li
          key={row.mediaId}
          className="border-border bg-surface-raised flex gap-4 rounded-md border p-4"
        >
          <Cover row={row} className="h-[84px] w-14 shrink-0 rounded" />
          <div className="min-w-0">
            <p className="text-lg font-semibold">
              <TitleLink row={row} />
            </p>
            <p className="text-fg-muted mt-1 text-sm font-semibold">
              {t("library.card.line", {
                kind: t(`media.kinds.${row.type as "movie"}`),
                status: t(`library.status.${row.status}`),
              })}
            </p>
            {row.totalEpisodes > 0 ? (
              <p className="mt-1 text-sm">
                {t("library.card.progress", {
                  done: row.progress,
                  total: row.totalEpisodes,
                })}
              </p>
            ) : null}
            {row.timesWatched > 0 ? (
              <p className="mt-1 text-sm">
                {t("library.card.watched", { count: row.timesWatched })}
              </p>
            ) : null}
            {row.score ? (
              <p className="mt-1 text-sm">
                {t("library.card.score", { score: row.score })}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { query, view, counts, sections } = loaderData;
  const pages = Object.fromEntries(
    sections.map((section) => [section.status, section.page]),
  ) as Record<LibraryStatus, number>;
  const searching = Boolean(query.q || query.year || query.score);
  const total = query.type ? counts[query.type] : counts.all;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("library.title")}</h1>
      <p className="text-fg-muted mt-2">{t("library.description")}</p>

      <nav aria-label={t("library.tabs.label")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {[null, ...libraryTypes].map((type) => {
            const active = (query.type ?? null) === type;
            return (
              <li key={type ?? "all"}>
                <Link
                  to={libraryHref(query, pages, { type })}
                  aria-current={active ? "page" : undefined}
                  className={`focus-visible:outline-accent inline-block rounded-md border px-3 py-1.5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    active
                      ? "bg-accent text-accent-fg border-transparent"
                      : "border-border text-fg"
                  }`}
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

      <Form
        method="get"
        key={JSON.stringify(query)}
        role="search"
        aria-label={t("library.filters.label")}
        className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] items-end gap-4"
      >
        {query.type ? (
          <input type="hidden" name="type" value={query.type} />
        ) : null}
        {query.view ? (
          <input type="hidden" name="view" value={query.view} />
        ) : null}
        <div className="col-span-full">
          <label htmlFor="q" className="font-semibold">
            {t("library.filters.search")}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            maxLength={searchMaxLength}
            defaultValue={query.q ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="year" className="font-semibold">
            {t("library.filters.year")}
          </label>
          <input
            id="year"
            name="year"
            type="number"
            inputMode="numeric"
            min={1000}
            max={2200}
            defaultValue={query.year ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="score" className="font-semibold">
            {t("library.filters.minScore")}
          </label>
          <select
            id="score"
            name="score"
            defaultValue={query.score ?? ""}
            className={inputClass}
          >
            <option value="">{t("library.filters.any")}</option>
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="font-semibold">
            {t("library.filters.sort")}
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={query.sort}
            className={inputClass}
          >
            {sortOptions.map((sort) => (
              <option key={sort} value={sort}>
                {t(`library.sort.${sort}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className="bg-accent text-accent-fg focus-visible:outline-accent rounded-md px-4 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("library.filters.apply")}
          </button>
          {searching || query.sort !== "recent" ? (
            <Link
              to={libraryHref(query, pages, { clear: true })}
              className="text-accent py-2 underline"
            >
              {t("library.filters.clear")}
            </Link>
          ) : null}
        </div>
      </Form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-fg-muted">
          {t("library.count", { count: total })}
        </p>
        <nav aria-label={t("library.views.label")}>
          <ul className="flex gap-3">
            {libraryViews.map((option) => (
              <li key={option}>
                <Link
                  to={libraryHref(query, pages, { view: option })}
                  aria-current={view === option ? "true" : undefined}
                  className={
                    view === option
                      ? "font-semibold"
                      : `${linkClass} font-normal`
                  }
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
              <Link
                to={libraryHref(query, pages, { clear: true })}
                className={linkClass}
              >
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
        <div className="mt-4 space-y-4">
          {sections.map((section) => {
            const name = t(`library.status.${section.status}`);
            // The one with the finished titles is the long one: it starts closed, and opens by
            // itself when the person is looking for something or is on its later pages.
            const open =
              section.total > 0 &&
              (section.status !== "completed" || searching || section.page > 1);
            return (
              <details
                key={`${query.type ?? "all"}-${section.status}`}
                open={open}
                className="border-border rounded-md border p-4"
              >
                <summary className="cursor-pointer text-xl font-semibold">
                  {name}{" "}
                  <span className="text-fg-muted font-normal">
                    {t("library.badge", { count: section.total })}
                  </span>
                </summary>
                {section.total === 0 ? (
                  <p className="text-fg-muted mt-3">
                    {t("library.sections.empty", { section: name })}
                  </p>
                ) : (
                  <>
                    <Entries rows={section.rows} view={view} />
                    {section.pages > 1 ? (
                      <nav
                        aria-label={t("library.pagination.label", {
                          section: name,
                        })}
                        className="mt-4 flex items-center justify-between gap-4"
                      >
                        {section.page > 1 ? (
                          <Link
                            to={libraryHref(query, pages, {
                              section: {
                                status: section.status,
                                page: section.page - 1,
                              },
                            })}
                            rel="prev"
                            className={linkClass}
                          >
                            {t("library.pagination.previous")}
                          </Link>
                        ) : (
                          <span />
                        )}
                        <p className="text-fg-muted">
                          {t("library.pagination.page", {
                            page: section.page,
                            pages: section.pages,
                          })}
                        </p>
                        {section.page < section.pages ? (
                          <Link
                            to={libraryHref(query, pages, {
                              section: {
                                status: section.status,
                                page: section.page + 1,
                              },
                            })}
                            rel="next"
                            className={linkClass}
                          >
                            {t("library.pagination.next")}
                          </Link>
                        ) : (
                          <span />
                        )}
                      </nav>
                    ) : null}
                  </>
                )}
              </details>
            );
          })}
        </div>
      )}
    </main>
  );
}
