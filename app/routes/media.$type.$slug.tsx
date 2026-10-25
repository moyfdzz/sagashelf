import { Trans, useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/media.$type.$slug";
import { useFormatters } from "~/lib/format";
import { getInstance, getLocale } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { getEntry } from "~server/db/library";
import { getMediaDetail } from "~server/db/media-detail";
import { imageSrc } from "~server/images/sources";
import { importMedia, needsRefresh } from "~server/media/import";
import { buildJsonLd, shortDescription } from "~server/media/json-ld";
import { idFromSlug, isMediaKind, mediaPath } from "~server/media/slug";
import { getDb, getMediaProviders, runInBackground } from "~server/runtime-env";

const openGraphType = {
  movie: "video.movie",
  series: "video.tv_show",
  anime: "video.other",
  book: "book",
  manga: "book",
} as const;

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  const id = idFromSlug(params.slug);
  if (!id || !isMediaKind(params.type)) throw data(null, { status: 404 });

  const db = await getDb();
  const detail = await getMediaDetail(db, id);
  if (!detail) throw data(null, { status: 404 });

  // The words in the address are for people. A wrong or old one goes to the right one.
  const url = new URL(request.url);
  const path = mediaPath(detail.type, detail.title, detail.id);
  if (url.pathname !== path) return redirect(path, 301);

  const locale = getLocale(context) === "en" ? "en" : "es";
  if (needsRefresh(detail, locale)) {
    // The page does not wait for the provider: this visit shows what we hold, the next one the
    // fresh data. A failure only means it is tried again on a later visit.
    runInBackground(
      importMedia(
        { db, providers: getMediaProviders() },
        detail.provider,
        detail.externalId,
        locale,
      ).catch((error: unknown) => {
        console.log(
          JSON.stringify({
            event: "media.refresh_failed",
            provider: detail.provider,
            error: error instanceof Error ? error.name : "unknown",
          }),
        );
      }),
    );
  }

  const other = locale === "es" ? "en" : "es";
  const synopsisLocale = detail.synopsis[locale] ? locale : other;
  const synopsis = detail.synopsis[synopsisLocale] ?? null;

  // What the signed-in person has done with this title. The page is the same for everyone
  // otherwise, so only this block changes.
  const user = await getOptionalUser(args);
  const entry = user ? await getEntry(db, user.id, detail.id) : null;
  const library = user
    ? { signedIn: true as const, status: entry?.status ?? null }
    : {
        signedIn: false as const,
        status: null,
        signInPath: signInPath(request.url),
      };

  const { t } = getInstance(context);
  const description = shortDescription(synopsis);
  const poster = imageSrc(detail.imageUrl, "w342");
  const shareImage = imageSrc(detail.imageUrl, "w500");
  const canonicalUrl = `${url.origin}${path}`;
  const shareImageUrl = shareImage ? `${url.origin}${shareImage}` : null;

  return {
    id: detail.id,
    library,
    type: detail.type,
    title: detail.title,
    pageTitle: t("app.pageTitle", { title: detail.title }),
    originalTitle: detail.originalTitle,
    year: detail.year,
    status: detail.status,
    synopsis,
    synopsisLocale,
    description,
    poster,
    seasons: detail.seasons,
    sourceUrl:
      detail.provider === "tmdb"
        ? `https://www.themoviedb.org/${detail.externalId}`
        : null,
    canonicalUrl,
    shareImageUrl,
    jsonLd: buildJsonLd({
      type: detail.type,
      externalId: detail.externalId,
      title: detail.title,
      originalTitle: detail.originalTitle,
      description,
      year: detail.year,
      url: canonicalUrl,
      image: shareImageUrl,
      seasonCount: detail.seasons.filter((season) => season.number > 0).length,
    }),
  };
}

// The block of the library shows what this person has done, so no shared cache keeps the page.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return [
    { title: loaderData.pageTitle },
    ...(loaderData.description
      ? [{ name: "description", content: loaderData.description }]
      : []),
    { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
    { property: "og:type", content: openGraphType[loaderData.type] },
    { property: "og:title", content: loaderData.title },
    { property: "og:url", content: loaderData.canonicalUrl },
    ...(loaderData.description
      ? [{ property: "og:description", content: loaderData.description }]
      : []),
    ...(loaderData.shareImageUrl
      ? [
          { property: "og:image", content: loaderData.shareImageUrl },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : [{ name: "twitter:card", content: "summary" }]),
    // A data block, not a script that runs, so the page's CSP does not need to allow it.
    { "script:ld+json": loaderData.jsonLd },
  ];
}

function asDate(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

export default function MediaDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const item = loaderData;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-col gap-6 sm:flex-row">
        {item.poster ? (
          <img
            src={item.poster}
            alt={t("media.posterAlt", { title: item.title })}
            width={342}
            height={513}
            className="border-border h-auto w-48 max-w-full shrink-0 self-start rounded-md border"
          />
        ) : null}
        <div>
          <h1 className="text-3xl font-bold">
            {item.title}
            {item.year ? (
              <span className="text-fg-muted font-normal">
                {" "}
                {t("search.year", { year: item.year })}
              </span>
            ) : null}
          </h1>
          {item.originalTitle ? (
            <p className="text-fg-muted mt-1">
              {t("media.originalTitle", { title: item.originalTitle })}
            </p>
          ) : null}
          <p className="text-fg-muted mt-2 font-semibold">
            {t("media.summary", {
              kind: t(`media.kinds.${item.type}`),
              status: t(`media.status.${item.status}`),
            })}
          </p>

          <h2 className="mt-6 text-xl font-semibold">{t("media.synopsis")}</h2>
          {item.synopsis ? (
            <p lang={item.synopsisLocale} className="mt-2">
              {item.synopsis}
            </p>
          ) : (
            <p className="text-fg-muted mt-2">{t("media.noSynopsis")}</p>
          )}

          {item.sourceUrl ? (
            <p className="mt-4">
              <a
                href={item.sourceUrl}
                rel="noreferrer"
                className="text-accent underline"
              >
                {t("media.viewOnTmdb")}
              </a>
            </p>
          ) : null}

          <div className="mt-6">
            {item.library.signedIn ? (
              item.library.status ? (
                <p>
                  <span className="font-semibold">
                    {t("media.library.inLibrary", {
                      status: t(`library.status.${item.library.status}`),
                    })}
                  </span>{" "}
                  {/* A plain link: the entry page has its own security policy, which only a new
                      document gets. */}
                  <a
                    href={`/library/${item.id}`}
                    className="text-accent underline"
                  >
                    {t("media.library.edit")}
                  </a>
                </p>
              ) : (
                // A whole-page form: the entry page it leads to has its own security policy.
                <Form method="post" action="/library/add" reloadDocument>
                  <input type="hidden" name="mediaId" value={item.id} />
                  <button
                    type="submit"
                    className="bg-accent text-accent-fg focus-visible:outline-accent rounded-md px-4 py-2 font-semibold transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {t("media.library.add")}
                  </button>
                </Form>
              )
            ) : (
              <a
                href={item.library.signInPath}
                className="text-accent underline"
              >
                {t("media.library.signIn")}
              </a>
            )}
          </div>
        </div>
      </div>

      {item.seasons.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">{t("media.seasons")}</h2>
          <ul className="mt-3 space-y-2">
            {item.seasons.map((season) => (
              <li
                key={season.number}
                className="border-border bg-surface-raised rounded-md border"
              >
                <details>
                  <summary className="cursor-pointer px-4 py-3 font-semibold">
                    {season.title ??
                      t("media.season", { number: season.number })}
                    <span className="text-fg-muted font-normal">
                      {t("media.seasonDetails", {
                        count: season.episodes.length,
                        context: season.airDate ? "dated" : undefined,
                        date: season.airDate
                          ? formatDate(asDate(season.airDate))
                          : "",
                      })}
                    </span>
                  </summary>
                  <ol className="border-border space-y-1 border-t px-4 py-3">
                    {season.episodes.map((episode) => (
                      <li key={episode.number}>
                        {t("media.episodeLine", {
                          number: episode.number,
                          title:
                            episode.title ??
                            t("media.episode", { number: episode.number }),
                        })}
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-fg-muted mt-10 text-sm">
        <Trans
          i18nKey="media.sources"
          components={{
            credits: <Link to="/credits" className="text-accent underline" />,
          }}
        />
      </p>
    </main>
  );
}
