import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import type { LibraryData, LibraryPathChange } from "~/routes/library";
import { linkClass, primaryButtonClass, secondaryLinkClass } from "~/lib/ui";

/**
 * The lists and limits that live in `server/`, which a component may not import: the route hands
 * them over.
 */
export type FilterOptions = {
  searchMaxLength: number;
  visibilityLevels: readonly NonNullable<LibraryData["query"]["visibility"]>[];
  sortOptions: readonly LibraryData["query"]["sort"][];
};

const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";

type Props = {
  query: LibraryData["query"];
  pathTo: (change: LibraryPathChange) => string;
  /** Whether any filter or search is on, which shows the way to clear them. */
  searching: boolean;
  options: FilterOptions;
};

/** The search and the filters of the library. A plain GET form, so it works without JavaScript. */
export function FiltersForm({
  query,
  pathTo,
  searching,
  options: { searchMaxLength, visibilityLevels, sortOptions },
}: Props) {
  const { t } = useTranslation();
  return (
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
      {query.rated ? (
        <input type="hidden" name="rated" value={query.rated} />
      ) : null}
      {query.genre ? (
        <input type="hidden" name="genre" value={query.genre} />
      ) : null}
      {query.genre ? (
        <p className="col-span-full flex flex-wrap items-center gap-x-3">
          <span>
            {t("library.filters.genreOnly", {
              genre: t(`genres.${query.genre}`),
            })}
          </span>
          <Link to={pathTo({ ungenre: true })} className={linkClass}>
            {t("library.filters.clearGenre")}
          </Link>
        </p>
      ) : null}
      {query.rated ? (
        <p className="col-span-full flex flex-wrap items-center gap-x-3">
          <span>
            {t("library.filters.ratedExactly", { score: query.rated })}
          </span>
          <Link to={pathTo({ unrate: true })} className={linkClass}>
            {t("library.filters.clearRated")}
          </Link>
        </p>
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
          {t("library.filters.score")}
        </label>
        <select
          id="score"
          name="score"
          defaultValue={query.score ?? ""}
          className={inputClass}
        >
          <option value="">{t("library.filters.any")}</option>
          <option value="none">{t("library.filters.unscored")}</option>
          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => (
            <option key={score} value={score}>
              {t("library.filters.scoreAtLeast", { score })}
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
          <Link to={pathTo({ clear: true })} className={secondaryLinkClass}>
            {t("library.filters.clear")}
          </Link>
        ) : null}
      </div>
    </Form>
  );
}
