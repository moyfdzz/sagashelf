import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import { linkClass, primaryButtonClass } from "~/lib/ui";
import type { Route } from "./+types/sagas";
import { getInstance, getLocale } from "~/middleware/i18next";
import { listSagas } from "~server/db/sagas";
import { getDb } from "~server/runtime-env";
import { normalizeQuery, queryMaxLength } from "~server/search/normalize";
import { privateRouteHeaders } from "~server/http/cache";

export async function loader({ request, context }: Route.LoaderArgs) {
  const locale = getLocale(context) === "en" ? "en" : "es";
  const { t } = getInstance(context);
  // The same limit as the search of titles; a longer text is cut, not refused.
  const q = [...(new URL(request.url).searchParams.get("q") ?? "").trim()]
    .slice(0, queryMaxLength)
    .join("");

  // What the search compares: a text that is only an accent or a space is empty here, and finds
  // every saga, so the page must not say it was a search.
  const search = normalizeQuery(q);
  const sagas = await listSagas(await getDb(), { search, locale });

  const title = t("sagas.title");
  return {
    q,
    searching: search !== "",
    pageTitle: t("app.pageTitle", { title }),
    description: t("sagas.description"),
    canonicalUrl: `${new URL(request.url).origin}/sagas`,
    sagas: sagas.map((saga) => ({
      slug: saga.slug,
      title: saga.titles[locale] || saga.title,
      works: saga.works,
      // A franchise is a Wikidata class of its own, not a format a person can follow.
      formats: saga.formats.filter((format) => format !== "franchise"),
    })),
  };
}

// The header of the page shows who is signed in, so no shared cache keeps it.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return [
    { title: loaderData.pageTitle },
    { name: "description", content: loaderData.description },
    // A search is a view of the same list, so it points at the list itself.
    { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
  ];
}

export default function SagasPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, searching, sagas } = loaderData;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t("sagas.title")}</h1>
      <p className="text-fg-muted mt-2">{t("sagas.intro")}</p>

      {/* A plain GET form: it works without JavaScript, and with it the router does the move. */}
      <Form
        method="get"
        action="/sagas"
        role="search"
        className="mt-6 flex items-end gap-2"
      >
        <div className="flex-1">
          <label htmlFor="sagas-q" className="font-semibold">
            {t("sagas.searchLabel")}
          </label>
          <input
            id="sagas-q"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={queryMaxLength}
            autoComplete="off"
            placeholder={t("sagas.placeholder")}
            className="border-input-edge bg-surface text-fg placeholder:text-fg-muted focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>
        <button type="submit" className={primaryButtonClass}>
          {t("search.submit")}
        </button>
      </Form>

      <p
        aria-live="polite"
        className="text-fg-muted mt-4 font-semibold break-words"
      >
        {searching
          ? t("sagas.resultsFor", { count: sagas.length, q })
          : t("sagas.count", { count: sagas.length })}
      </p>

      {sagas.length === 0 ? (
        <p className="mt-4">
          {searching ? t("sagas.noResults") : t("sagas.empty")}{" "}
          {searching ? (
            <Link to="/sagas" className={linkClass}>
              {t("sagas.showAll")}
            </Link>
          ) : null}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sagas.map((saga) => (
            <li
              key={saga.slug}
              className="border-border bg-surface-raised rounded-md border px-4 py-2"
            >
              <Link
                to={`/sagas/${saga.slug}`}
                className={`${linkClass} text-lg break-words`}
              >
                {saga.title}
              </Link>
              <p className="text-fg-muted pb-2 text-sm">
                {[
                  t("sagas.works", { count: saga.works }),
                  ...(saga.formats.length > 0
                    ? [
                        saga.formats
                          .map((format) => t(`media.formats.${format}`))
                          .join(", "),
                      ]
                    : []),
                ].join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
