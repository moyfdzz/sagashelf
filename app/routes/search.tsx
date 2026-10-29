import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/search";
import { SearchBox } from "~/components/SearchBox";
import { tabClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { getMediaProviders } from "~server/runtime-env";
import { getDb, getSearchCache, getSearchLimiter } from "~server/runtime-env";
import { searchLocal } from "~server/db/search-local";
import { rateLimit } from "~server/rate-limit";
import {
  queryMaxLength,
  queryMinLength,
  searchTypeSchema,
  searchTypes,
  type SearchType,
} from "~server/search/normalize";
import { imageSrc } from "~server/images/sources";
import { mediaPath, openPath } from "~server/media/slug";
import { runSearch } from "~server/search/pipeline";
import { searchPath } from "~server/search/path";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { t } = getInstance(context);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  // A type that is not one of ours means "all".
  const typeResult = searchTypeSchema.safeParse(url.searchParams.get("type"));
  const type: SearchType | undefined = typeResult.success
    ? typeResult.data
    : undefined;
  const title = t("search.title");
  const providers = getMediaProviders();
  // Books and manga get a tab only when a provider can answer them; the others are always there.
  const tabs = searchTypes.filter(
    (kind) =>
      (kind !== "book" && kind !== "manga") ||
      providers.some((provider) => provider.capabilities.types.includes(kind)),
  );

  if ([...q].length > queryMaxLength) {
    return {
      title,
      q: [...q].slice(0, queryMaxLength).join(""),
      type,
      tabs,
      status: "too_long" as const,
      results: [],
      failed: [],
    };
  }
  if ([...q].length < queryMinLength) {
    return {
      title,
      q,
      type,
      tabs,
      status: "idle" as const,
      results: [],
      failed: [],
    };
  }

  // Only a real search counts against the limit, not the empty page.
  const limited = await rateLimit(getSearchLimiter(), request, "search");
  if (limited) throw limited;

  const response = await runSearch(
    {
      searchLocal: async (normalized, kind, language) =>
        searchLocal(await getDb(), normalized, kind, language),
      providers,
      cache: getSearchCache(),
    },
    { query: q, type, locale: getLocale(context) === "en" ? "en" : "es" },
  );

  return {
    title,
    q,
    type,
    tabs,
    status: "done" as const,
    // A title we hold opens at once; one that only a provider knows is saved when it is opened.
    results: response.results.map((result) => ({
      ...result,
      href: result.id
        ? mediaPath(result.type, result.title, result.id)
        : openPath(result.provider, result.externalId),
      // `/media/open` saves the title and redirects: it has no page of its own, so a move
      // inside the page (which asks for the data of a page) cannot follow it.
      wholePage: result.id === null,
      // Results kept in the cache before posters existed have no `imageUrl`.
      poster: imageSrc(result.imageUrl ?? null, "w92"),
    })),
    failed: response.failed,
  };
}

export function headers() {
  // Searches differ by session in the header and call other services, so no shared cache.
  return { "Cache-Control": "private, no-store" };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // Result pages are endless and add nothing to a search engine.
    { name: "robots", content: "noindex, follow" },
  ];
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, type, status, results, failed } = loaderData;
  const tabs: (SearchType | undefined)[] = [undefined, ...loaderData.tabs];

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("search.title")}</h1>

      <SearchBox initialQuery={q} type={type} />

      <nav aria-label={t("search.tabsLabel")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <li key={tab ?? "all"}>
              <Link
                to={searchPath(q, tab)}
                aria-current={tab === type ? "page" : undefined}
                className={tabClass(tab === type)}
              >
                {t(`search.types.${tab ?? "all"}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6" role="status">
        {status === "idle" ? (
          <p className="text-fg-muted">
            {t("search.prompt", { min: queryMinLength })}
          </p>
        ) : null}
        {status === "too_long" ? (
          <p className="text-danger-text font-semibold">
            {t("search.tooLong", { max: queryMaxLength })}
          </p>
        ) : null}
        {status === "done" && results.length === 0 ? (
          <p>{t("search.empty", { query: q })}</p>
        ) : null}
        {status === "done" && results.length > 0 ? (
          <p className="text-fg-muted">
            {t("search.count", { count: results.length })}
          </p>
        ) : null}
        {failed.length > 0 ? (
          <p className="border-border bg-surface-raised mt-3 rounded-md border px-4 py-3">
            {t("search.partial")}
          </p>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {results.map((result) => (
            <li
              key={`${result.provider}:${result.externalId}`}
              className="border-border bg-surface-raised flex gap-4 rounded-md border p-4"
            >
              {result.poster ? (
                <img
                  src={result.poster}
                  alt={t("media.posterAlt", { title: result.title })}
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
                  {result.wholePage ? (
                    <a href={result.href} className="text-accent underline">
                      {result.title}
                    </a>
                  ) : (
                    <Link to={result.href} className="text-accent underline">
                      {result.title}
                    </Link>
                  )}
                  {result.year ? (
                    <span className="text-fg-muted font-normal">
                      {" "}
                      {t("search.year", { year: result.year })}
                    </span>
                  ) : null}
                </p>
                {result.originalTitle ? (
                  <p className="text-fg-muted text-sm">
                    {result.originalTitle}
                  </p>
                ) : null}
                {result.creators?.length ? (
                  <p className="text-fg-muted text-sm">
                    {t("search.by", { names: result.creators.join(", ") })}
                  </p>
                ) : null}
                <p className="text-fg-muted mt-1 text-sm font-semibold">
                  {t(`search.types.${result.type}`)}
                </p>
                {result.synopsis ? (
                  <p className="mt-2 line-clamp-2">{result.synopsis}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
