import { useTranslation } from "react-i18next";
import {
  Link,
  useFetcher,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import type { Route } from "./+types/search";
import { SearchBox } from "~/components/SearchBox";
import { linkClass, smallButtonClass, tabClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import { getEntryStatuses } from "~server/db/library";
import type { LibraryStatus } from "~server/library/schema";
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

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
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
      signedIn: false as const,
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
      signedIn: false as const,
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

  // A signed-in person sees which of the results they already hold. The suggestions of the search
  // box ask without it (`suggest=1`), so typing does not cost a query for the person on every pause.
  const user =
    url.searchParams.get("suggest") === "1"
      ? null
      : await getOptionalUser(args);
  const held = user
    ? await getEntryStatuses(
        await getDb(),
        user.id,
        response.results.flatMap((result) => (result.id ? [result.id] : [])),
      )
    : new Map<string, LibraryStatus>();

  return {
    title,
    q,
    type,
    tabs,
    status: "done" as const,
    signedIn: user !== null,
    // A title we hold opens at once; one that only a provider knows is saved when it is opened.
    results: response.results.map((result) => ({
      ...result,
      href: result.id
        ? mediaPath(result.type, result.title, result.id)
        : openPath(result.provider, result.externalId),
      // `/media/open` saves the title and redirects: it has no page of its own, so a move
      // inside the page (which asks for the data of a page) cannot follow it.
      wholePage: result.id === null,
      // The status of the person for a title they hold; none for one they do not, or a visitor.
      libraryStatus: result.id ? (held.get(result.id) ?? null) : null,
      // Results kept in the cache before posters existed have no `imageUrl`.
      poster: imageSrc(result.imageUrl ?? null, "w92"),
    })),
    failed: response.failed,
  };
}

/**
 * Adding a title changes one result, which already shows it. Running the search again would ask
 * the providers and the database for everything for nothing.
 */
export function shouldRevalidate({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formAction === "/library/add" || formAction === "/library/add-external") {
    return false;
  }
  return defaultShouldRevalidate;
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

type Result = Route.ComponentProps["loaderData"]["results"][number];

/**
 * One result. A signed-in person can add it to their library from here: a form sent with a
 * fetcher, so the result says "In your library" at once and, if the server refuses, goes back with
 * a message. Without JavaScript it is a plain form that takes them to their entry. A title we do
 * not hold yet is saved as it is added, and from then on the result links to its page.
 */
function ResultRow({
  result,
  signedIn,
}: {
  result: Result;
  signedIn: boolean;
}) {
  const { t } = useTranslation();
  const fetcher = useFetcher({
    key: `add-${result.provider}:${result.externalId}`,
  });
  const busy = fetcher.state !== "idle";
  const answer = fetcher.data as { ok?: boolean; href?: string } | undefined;
  const saved = answer?.ok && answer.href ? { href: answer.href } : null;
  // What the person holds, or what they have just asked for, which the server will make planned.
  const status =
    result.libraryStatus ?? (busy || answer?.ok ? "planned" : null);

  const control = status ? (
    <p className="text-sm font-semibold">
      {t("search.inLibrary", { status: t(`library.status.${status}`) })}
    </p>
  ) : (
    <>
      <fetcher.Form
        method="post"
        action={result.id ? "/library/add" : "/library/add-external"}
      >
        {result.id ? (
          <input type="hidden" name="mediaId" value={result.id} />
        ) : (
          <>
            <input type="hidden" name="provider" value={result.provider} />
            <input type="hidden" name="id" value={result.externalId} />
          </>
        )}
        <button
          type="submit"
          disabled={busy}
          aria-label={t("search.addLabel", { title: result.title })}
          className={smallButtonClass}
        >
          {t("search.add")}
        </button>
      </fetcher.Form>
      {answer !== undefined && !answer.ok && !busy ? (
        <p role="alert" className="text-danger-text mt-1 text-sm font-semibold">
          {t("search.addFailed")}
        </p>
      ) : null}
    </>
  );

  return (
    <li className="border-border bg-surface-raised flex gap-4 rounded-md border p-4">
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
          {saved ? (
            <Link to={saved.href} className={linkClass}>
              {result.title}
            </Link>
          ) : result.wholePage ? (
            <a href={result.href} className={linkClass}>
              {result.title}
            </a>
          ) : (
            <Link to={result.href} className={linkClass}>
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
          <p className="text-fg-muted text-sm">{result.originalTitle}</p>
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
        {signedIn ? <div className="mt-3">{control}</div> : null}
      </div>
    </li>
  );
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, type, status, results, failed, signedIn } = loaderData;
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
            <ResultRow
              key={`${result.provider}:${result.externalId}`}
              result={result}
              signedIn={signedIn}
            />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
