import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import type { Route } from "./+types/library";
import { getInstance } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { listEntries } from "~server/db/library";
import { imageSrc } from "~server/images/sources";
import {
  libraryQuerySchema,
  libraryStatuses,
  pageSize,
  sortOptions,
  type LibraryQuery,
} from "~server/library/schema";
import { getDb } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const query = libraryQuerySchema.parse(
    Object.fromEntries(new URL(args.request.url).searchParams),
  );

  const { rows, total } = await listEntries(await getDb(), user.id, query);
  const { t } = getInstance(args.context);

  return {
    title: t("library.title"),
    query,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    rows: rows.map((row) => ({
      ...row,
      poster: imageSrc(row.imageUrl, "w185"),
    })),
  };
}

// A page with a person's data is never kept by a shared cache.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

function pageHref(query: LibraryQuery, page: number) {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.status) params.set("status", query.status);
  if (query.year) params.set("year", String(query.year));
  if (query.score) params.set("score", String(query.score));
  if (query.sort !== "recent") params.set("sort", query.sort);
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/library?${text}` : "/library";
}

const kinds = ["anime", "movie", "series", "book", "manga"] as const;

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";

export default function Library({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { query, total, pages, rows } = loaderData;
  const filtered = Boolean(
    query.type || query.status || query.year || query.score,
  );

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("library.title")}</h1>
      <p className="text-fg-muted mt-2">{t("library.description")}</p>

      <Form
        method="get"
        role="search"
        aria-label={t("library.filters.label")}
        className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <div>
          <label htmlFor="type" className="font-semibold">
            {t("library.filters.type")}
          </label>
          <select
            id="type"
            name="type"
            defaultValue={query.type ?? ""}
            className={inputClass}
          >
            <option value="">{t("library.filters.any")}</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`media.kinds.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="font-semibold">
            {t("library.filters.status")}
          </label>
          <select
            id="status"
            name="status"
            defaultValue={query.status ?? ""}
            className={inputClass}
          >
            <option value="">{t("library.filters.any")}</option>
            {libraryStatuses.map((status) => (
              <option key={status} value={status}>
                {t(`library.status.${status}`)}
              </option>
            ))}
          </select>
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
          {filtered || query.sort !== "recent" ? (
            <Link to="/library" className="text-accent py-2 underline">
              {t("library.filters.clear")}
            </Link>
          ) : null}
        </div>
      </Form>

      <p role="status" className="text-fg-muted mt-6">
        {t("library.count", { count: total })}
      </p>

      {total === 0 ? (
        <div className="mt-4">
          <p>
            {filtered ? t("library.empty.noMatch") : t("library.empty.none")}
          </p>
          {filtered ? null : (
            <p className="mt-3">
              <Link to="/search" className="text-accent underline">
                {t("library.empty.search")}
              </Link>
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li
              key={row.mediaId}
              className="border-border bg-surface-raised flex gap-4 rounded-md border p-4"
            >
              {row.poster ? (
                <img
                  src={row.poster}
                  alt={t("media.posterAlt", { title: row.title })}
                  width={56}
                  height={84}
                  loading="lazy"
                  className="h-[84px] w-14 shrink-0 rounded"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="bg-border h-[84px] w-14 shrink-0 rounded"
                />
              )}
              <div className="min-w-0">
                <p className="text-lg font-semibold">
                  {/* A plain link: the entry page has its own security policy, which only a new
                      document gets. */}
                  <a
                    href={`/library/${row.mediaId}`}
                    className="text-accent underline"
                  >
                    {row.title}
                  </a>
                  {row.year ? (
                    <span className="text-fg-muted font-normal">
                      {" "}
                      {t("search.year", { year: row.year })}
                    </span>
                  ) : null}
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
                {row.score ? (
                  <p className="mt-1 text-sm">
                    {t("library.card.score", { score: row.score })}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav
          aria-label={t("library.pagination.label")}
          className="mt-6 flex items-center justify-between gap-4"
        >
          {query.page > 1 ? (
            <Link
              to={pageHref(query, query.page - 1)}
              rel="prev"
              className="text-accent underline"
            >
              {t("library.pagination.previous")}
            </Link>
          ) : (
            <span />
          )}
          <p className="text-fg-muted">
            {t("library.pagination.page", { page: query.page, pages })}
          </p>
          {query.page < pages ? (
            <Link
              to={pageHref(query, query.page + 1)}
              rel="next"
              className="text-accent underline"
            >
              {t("library.pagination.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
