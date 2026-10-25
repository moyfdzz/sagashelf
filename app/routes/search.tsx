import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Route } from "./+types/search";
import { SearchBox } from "~/components/SearchBox";
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
import { runSearch } from "~server/search/pipeline";

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

  if ([...q].length > queryMaxLength) {
    return {
      title,
      q: [...q].slice(0, queryMaxLength).join(""),
      type,
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
      searchLocal: async (normalized, kind) =>
        searchLocal(await getDb(), normalized, kind),
      providers: getMediaProviders(),
      cache: getSearchCache(),
    },
    { query: q, type, locale: getLocale(context) === "en" ? "en" : "es" },
  );

  return {
    title,
    q,
    type,
    status: "done" as const,
    results: response.results,
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

function tabHref(q: string, type: SearchType | undefined) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  const text = params.toString();
  return text ? `/search?${text}` : "/search";
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, type, status, results, failed } = loaderData;
  const tabs: (SearchType | undefined)[] = [undefined, ...searchTypes];

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("search.title")}</h1>

      <SearchBox initialQuery={q} type={type} />

      <nav aria-label={t("search.tabsLabel")} className="mt-6">
        <ul className="border-border flex flex-wrap gap-x-2 gap-y-1 border-b pb-2">
          {tabs.map((tab) => (
            <li key={tab ?? "all"}>
              <Link
                to={tabHref(q, tab)}
                aria-current={tab === type ? "page" : undefined}
                className={`focus-visible:outline-accent rounded-md px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  tab === type
                    ? "text-accent underline underline-offset-8"
                    : "text-fg-muted hover:text-accent"
                }`}
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
              className="border-border bg-surface-raised rounded-md border p-4"
            >
              <p className="text-lg font-semibold">
                {result.title}
                {result.year ? (
                  <span className="text-fg-muted font-normal">
                    {" "}
                    {t("search.year", { year: result.year })}
                  </span>
                ) : null}
              </p>
              {result.originalTitle ? (
                <p className="text-fg-muted text-sm">{result.originalTitle}</p>
              ) : null}
              <p className="text-fg-muted mt-1 text-sm font-semibold">
                {t(`search.types.${result.type}`)}
              </p>
              {result.synopsis ? (
                <p className="mt-2 line-clamp-2">{result.synopsis}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
