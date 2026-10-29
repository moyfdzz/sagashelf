import { useTranslation } from "react-i18next";
import { data, Form, Link, useFetcher, useFetchers } from "react-router";

import type { Route } from "./+types/library";
import type { action as stepAction } from "./library.$mediaId.step";
import {
  linkClass,
  primaryButtonClass,
  secondaryLinkClass,
  segmentClass,
  segmentedGroupClass,
  smallButtonClass,
  tabClass,
} from "~/lib/ui";
import { NotesPreview } from "~/components/NotesPreview";
import { ProgressBar, ProgressText, progressOf } from "~/components/Progress";
import { canStep } from "~/lib/library-step";
import { readingContext } from "~/lib/media";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { listLibrary, type LibraryRow } from "~server/db/library";
import { imageSrc } from "~server/images/sources";
import {
  libraryQuerySchema,
  libraryTypes,
  libraryViews,
  searchMaxLength,
  visibilityLevels,
  sortOptions,
  type LibraryStatus,
  type LibraryView,
} from "~server/library/schema";
import {
  chooseView,
  readViewCookie,
  viewCookieHeader,
} from "~server/library/view";
import { libraryPath } from "~server/library/path";
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

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";

// The color of the stripe of a section. It reuses the colors of the design (light and dark); the
// name of the section is always written, so the color is never the only signal.
const stripe: Record<LibraryStatus, string> = {
  in_progress: "border-l-accent",
  planned: "border-l-fg-muted",
  paused: "border-l-fg-muted",
  dropped: "border-l-danger-edge",
  completed: "border-l-success-edge",
};

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

/** Says who can see the entry, only when it is not private: most are, and a label on each would be noise. */
function VisibilityTag({
  row,
  className = "",
}: {
  row: Row;
  className?: string;
}) {
  const { t } = useTranslation();
  if (row.visibility === "private") return null;
  return (
    <span
      className={`border-border bg-surface-raised text-fg-muted inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {t(`library.visibility.${row.visibility}`)}
    </span>
  );
}

const stepKey = (row: Row) => `step-${row.mediaId}`;

/**
 * The row as the person expects to see it right after pressing "+1": one more, before the server
 * has answered. When the step fails the fetcher is idle again and the real number comes back.
 */
function useShownRow(row: Row): Row {
  const pending = useFetchers().some(
    (fetcher) => fetcher.key === stepKey(row) && fetcher.state !== "idle",
  );
  return pending ? { ...row, progress: row.progress + 1 } : row;
}

/**
 * The quick "+1" of a row. A plain form that works without JavaScript (the server then sends the
 * person back to the library); with it, the number goes up at once and the page stays where it is.
 */
function StepButton({ row }: { row: Row }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof stepAction>({ key: stepKey(row) });
  const shown = useShownRow(row);
  if (!canStep(shown)) return null;

  const answer = fetcher.data as { ok?: boolean } | undefined;
  const failed = fetcher.state === "idle" && answer !== undefined && !answer.ok;
  return (
    <>
      <fetcher.Form
        method="post"
        action={`/library/${row.mediaId}/step`}
        className="inline"
      >
        <button
          type="submit"
          disabled={fetcher.state !== "idle"}
          aria-label={t("library.card.step", {
            context: row.progressUnit ?? "episodes",
            title: row.title,
          })}
          className={smallButtonClass}
        >
          {t("library.card.stepShort")}
        </button>
      </fetcher.Form>
      {failed ? (
        <p role="alert" className="text-danger-text mt-1 text-sm font-semibold">
          {t("library.card.stepFailed")}
        </p>
      ) : null}
    </>
  );
}

/** The words of the progress of a row, with the step that is on its way already counted. */
function ProgressWords({ row, className }: { row: Row; className?: string }) {
  return <ProgressText row={useShownRow(row)} className={className} />;
}

/** The bar of the progress of a row, with the step that is on its way already counted. */
function Bar({ row, className }: { row: Row; className: string }) {
  return <ProgressBar row={useShownRow(row)} className={className} />;
}

function Entries({ rows, view }: { rows: Row[]; view: LibraryView }) {
  const { t } = useTranslation();

  if (view === "titles") {
    return (
      <ul className="mt-3">
        {rows.map((row) => (
          <li
            key={row.mediaId}
            className="border-border flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0"
          >
            <p className="min-w-0 font-semibold">
              <TitleLink row={row} />
            </p>
            <div className="text-fg-muted flex shrink-0 items-center gap-2 text-sm tabular-nums">
              {row.notes ? (
                <NotesPreview
                  title={row.title}
                  notes={row.notes}
                  entryHref={`/library/${row.mediaId}`}
                />
              ) : null}
              <VisibilityTag row={row} />
              {row.score ? (
                t("library.card.scoreShort", { score: row.score })
              ) : (
                <>
                  <span aria-hidden="true">
                    {t("library.card.noScoreMark")}
                  </span>
                  <span className="sr-only">{t("library.editor.noScore")}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (view === "grid") {
    return (
      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((row) => (
          <li key={row.mediaId} className="group/card min-w-0">
            <div className="group-focus-within/card:ring-accent group-hover/card:ring-accent relative overflow-hidden rounded ring-2 ring-transparent transition-colors">
              <Cover
                row={row}
                className="aspect-[2/3] w-full rounded object-cover"
              />
              <VisibilityTag
                row={row}
                className="absolute top-2 left-2 shadow"
              />
              {row.score ? (
                <p className="bg-surface-raised text-fg absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-xs font-bold shadow">
                  <span aria-hidden="true">
                    {t("library.card.badge", { score: row.score })}
                  </span>
                  <span className="sr-only">
                    {t("library.card.score", { score: row.score })}
                  </span>
                </p>
              ) : null}
              <Bar row={row} className="absolute right-0 bottom-0 left-0" />
            </div>
            <p className="mt-2 text-sm font-semibold break-words">
              <TitleLink row={row} />
            </p>
            <div className="mt-1">
              {row.notes ? (
                <NotesPreview
                  title={row.title}
                  notes={row.notes}
                  entryHref={`/library/${row.mediaId}`}
                />
              ) : null}
            </div>
            <ProgressWords row={row} className="sr-only" />
            <div className="mt-1">
              <StepButton row={row} />
            </div>
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
          className="border-border bg-surface-raised hover:border-accent focus-within:border-accent flex gap-4 rounded-md border p-4 transition-colors hover:shadow-sm"
        >
          <Cover row={row} className="h-[120px] w-20 shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">
              <TitleLink row={row} />
            </p>
            <div className="text-fg-muted mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
              {t("library.card.line", {
                kind: t(`media.kinds.${row.type as "movie"}`),
                status: t(`library.status.${row.status}`),
              })}
              <VisibilityTag row={row} />
              {row.notes ? (
                <NotesPreview
                  title={row.title}
                  notes={row.notes}
                  entryHref={`/library/${row.mediaId}`}
                />
              ) : null}
            </div>
            {progressOf(row) || canStep(row) ? (
              <div className="mt-2 max-w-xs">
                <ProgressWords row={row} className="text-sm" />
                <Bar row={row} className="mt-1" />
                <div className="mt-2">
                  <StepButton row={row} />
                </div>
              </div>
            ) : null}
            {row.timesWatched > 0 ? (
              <p className="mt-2 text-sm">
                {t("library.card.watched", {
                  count: row.timesWatched,
                  context: readingContext(row.type),
                })}
              </p>
            ) : null}
            <p className="mt-2 text-sm">
              {row.score
                ? t("library.card.score", { score: row.score })
                : t("library.editor.noScore")}
            </p>
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
  const searching = Boolean(
    query.q || query.year || query.score || query.visibility,
  );
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
                  to={libraryPath(query, pages, { type })}
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
          <label htmlFor="visibility" className="font-semibold">
            {t("library.filters.visibility")}
          </label>
          <select
            id="visibility"
            name="visibility"
            defaultValue={query.visibility ?? ""}
            className={inputClass}
          >
            <option value="">{t("library.visibility.any")}</option>
            {visibilityLevels.map((level) => (
              <option key={level} value={level}>
                {t(`library.visibility.${level}`)}
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
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButtonClass}>
            {t("library.filters.apply")}
          </button>
          {searching || query.sort !== "recent" ? (
            <Link
              to={libraryPath(query, pages, { clear: true })}
              className={secondaryLinkClass}
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
          <ul className={segmentedGroupClass}>
            {libraryViews.map((option) => (
              <li key={option}>
                <Link
                  to={libraryPath(query, pages, { view: option })}
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
              <Link
                to={libraryPath(query, pages, { clear: true })}
                className={secondaryLinkClass}
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
                className={`group/section border-border rounded-md border border-l-4 p-4 ${stripe[section.status]}`}
              >
                <summary className="focus-visible:outline-accent flex cursor-pointer list-none items-center justify-between gap-3 rounded text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-3">
                    {name}
                    <span className="border-border bg-surface-raised text-fg-muted rounded-full border px-2.5 py-0.5 text-sm font-semibold">
                      {t("library.badge", { count: section.total })}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-fg-muted shrink-0 transition-transform group-open/section:rotate-180"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
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
                            to={libraryPath(query, pages, {
                              section: {
                                status: section.status,
                                page: section.page - 1,
                              },
                            })}
                            rel="prev"
                            className={secondaryLinkClass}
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
                            to={libraryPath(query, pages, {
                              section: {
                                status: section.status,
                                page: section.page + 1,
                              },
                            })}
                            rel="next"
                            className={secondaryLinkClass}
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
