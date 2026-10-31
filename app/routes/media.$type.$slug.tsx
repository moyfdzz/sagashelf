import { type ReactNode, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { data, Link, redirect } from "react-router";

import { externalLinkClass, linkClass, textLinkClass } from "~/lib/ui";
import type { Route } from "./+types/media.$type.$slug";
import { TitleLibrary } from "~/components/TitleLibrary";
import { useFormatters } from "~/lib/format";
import { getInstance, getLocale } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import { signInPath } from "~server/auth/sign-in-url";
import { getEntry } from "~server/db/library";
import { getMediaDetail } from "~server/db/media-detail";
import { getRelatedFormats } from "~server/db/wikidata-store";
import { imageSrc } from "~server/images/sources";
import { importMedia, isMissingLanguage, isStale } from "~server/media/import";
import { buildJsonLd, shortDescription } from "~server/media/json-ld";
import { groupRelated } from "~server/media/related";
import { idFromSlug, isMediaKind, mediaPath } from "~server/media/slug";
import { entryBackPath } from "~server/library/path";
import { searchBackPath } from "~server/search/path";
import { getDb, getMediaProviders, runInBackground } from "~server/runtime-env";
import { pickTitle } from "~server/db/titles";

/** How long a first visit in a new language waits for the provider before showing what it holds. */
const firstVisitWaitMs = 2500;

const logRefreshFailed = (provider: string, error: unknown) =>
  console.log(
    JSON.stringify({
      event: "media.refresh_failed",
      provider,
      error: error instanceof Error ? error.name : "unknown",
    }),
  );

const openGraphType = {
  movie: "video.movie",
  series: "video.tv_show",
  anime: "video.other",
  book: "book",
  manga: "book",
} as const;

/** Where the title is described: the key of its link text, the name to credit, and the page. */
function sourceOf(provider: string, externalId: string) {
  switch (provider) {
    case "tmdb":
      return {
        name: "tmdb" as const,
        label: "TMDB",
        url: `https://www.themoviedb.org/${externalId}`,
      };
    case "open_library":
      return {
        name: "openLibrary" as const,
        label: "Open Library",
        url: `https://openlibrary.org/works/${externalId}`,
      };
    case "mangadex":
      return {
        name: "mangadex" as const,
        label: "MangaDex",
        url: `https://mangadex.org/title/${externalId}`,
      };
    default:
      return null;
  }
}

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  const id = idFromSlug(params.slug);
  if (!id || !isMediaKind(params.type)) throw data(null, { status: 404 });

  const db = await getDb();
  const stored = await getMediaDetail(db, id);
  if (!stored) throw data(null, { status: 404 });
  let detail = stored;

  const locale = getLocale(context) === "en" ? "en" : "es";
  const refresh = (signal?: AbortSignal) =>
    importMedia(
      { db, providers: getMediaProviders() },
      stored.provider,
      stored.externalId,
      locale,
      signal,
    );
  if (isMissingLanguage(stored, locale)) {
    // The first visit in this language waits a moment for the provider, so the title and the
    // synopsis come in the right language. If it fails or is slow, this visit shows what we hold
    // and a later visit tries again.
    try {
      await refresh(AbortSignal.timeout(firstVisitWaitMs));
      detail = (await getMediaDetail(db, id)) ?? detail;
    } catch (error) {
      logRefreshFailed(stored.provider, error);
    }
  } else if (isStale(stored)) {
    // The page does not wait for the provider: this visit shows what we hold, the next one the
    // fresh data. A failure only means it is tried again on a later visit.
    runInBackground(
      refresh().catch((error: unknown) =>
        logRefreshFailed(stored.provider, error),
      ),
    );
  }

  // The words in the address are for people. A wrong or old one goes to the right one. The
  // address is compared through the params and not `url.pathname`: when a person moves here from
  // another page, the request is for the data of the page (`<address>.data`), which never equals
  // the path and would send the browser to the same address again and again.
  const title = pickTitle(detail, locale);
  const url = new URL(request.url);
  const path = mediaPath(detail.type, title, detail.id);
  if (`/media/${params.type}/${params.slug}` !== path) {
    return redirect(path, 301);
  }

  const other = locale === "es" ? "en" : "es";
  const synopsisLocale = detail.synopsis[locale] ? locale : other;
  const synopsis = detail.synopsis[synopsisLocale] ?? null;

  // What the signed-in person has done with this title. The page is the same for everyone
  // otherwise, so only this block changes.
  const user = await getOptionalUser(args);
  const entry = user ? await getEntry(db, user.id, detail.id, locale) : null;
  const library = user
    ? {
        signedIn: true as const,
        status: entry?.status ?? null,
        progress: entry?.progress ?? 0,
        progressUnit: entry?.progressUnit ?? null,
        progressTotal: entry?.progressTotal ?? null,
        // The episodes of the catalog, specials not counted: the end of a series.
        totalEpisodes: detail.seasons
          .filter((season) => season.number > 0)
          .reduce((sum, season) => sum + season.episodes.length, 0),
      }
    : {
        signedIn: false as const,
        status: null,
        signInPath: signInPath(request.url),
      };

  // What Wikidata says is the same story. The page is useful without it, so a failure only hides
  // the list.
  const related = groupRelated(
    await getRelatedFormats(db, detail.id).catch((error: unknown) => {
      console.log(
        JSON.stringify({
          event: "media.related_failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return [];
    }),
    locale,
  );

  const { t } = getInstance(context);
  const description = shortDescription(synopsis);
  const poster = imageSrc(detail.imageUrl, "w342");
  const shareImage = imageSrc(detail.imageUrl, "w500");
  const canonicalUrl = `${url.origin}${path}`;
  const shareImageUrl = shareImage ? `${url.origin}${shareImage}` : null;

  return {
    id: detail.id,
    // The results the person came from, when they came from the search. The page is private, so
    // it can depend on where the visit started.
    backToSearch: searchBackPath(request.headers.get("Referer"), url.origin),
    // The entry the person came from (its "View the title page" link), when they came from one.
    backToEntry: entryBackPath(request.headers.get("Referer"), url.origin),
    library,
    type: detail.type,
    title,
    pageTitle: t("app.pageTitle", { title }),
    originalTitle: detail.originalTitle,
    creators: detail.creators,
    genres: detail.genres,
    year: detail.year,
    status: detail.status,
    synopsis,
    synopsisLocale,
    description,
    poster,
    seasons: detail.seasons,
    related,
    source: sourceOf(detail.provider, detail.externalId),
    canonicalUrl,
    shareImageUrl,
    jsonLd: buildJsonLd({
      type: detail.type,
      externalId: detail.externalId,
      title,
      originalTitle: detail.originalTitle,
      description,
      year: detail.year,
      creators: detail.creators,
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

/**
 * The link back to where the person came from: the search, or the entry of the library. It is read
 * from the `Referer` of the first load. After a button of the library the loader runs again with
 * this very page as the `Referer`, and then the loader has none, so the link is kept here from
 * the first load. A new title (another `key`) starts again.
 */
function BackLink({
  toSearch,
  toEntry,
}: {
  toSearch: string | null;
  toEntry: string | null;
}) {
  const { t } = useTranslation();
  const [first] = useState({ toSearch, toEntry });

  if (first.toSearch) {
    return (
      <p className="mb-6">
        <Link to={first.toSearch} className={linkClass}>
          {t("media.backToSearch")}
        </Link>
      </p>
    );
  }
  if (first.toEntry) {
    return (
      <p className="mb-6">
        {/* A plain link: the entry page has its own security policy, which only a new document
            gets. */}
        <a href={first.toEntry} className={linkClass}>
          {t("media.backToEntry")}
        </a>
      </p>
    );
  }
  return null;
}

/** The link back to Wikidata that its credit asks for; Trans puts the words inside it. */
function WikidataLink({ children }: { children?: ReactNode }) {
  return (
    <a
      href="https://www.wikidata.org/"
      rel="noreferrer"
      className={textLinkClass}
    >
      {children}
    </a>
  );
}

export default function MediaDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const item = loaderData;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <BackLink
        key={item.id}
        toSearch={item.backToSearch}
        toEntry={item.backToEntry}
      />
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
          {item.creators.length > 0 ? (
            <p className="mt-2">
              {t("media.by", { names: item.creators.join(", ") })}
            </p>
          ) : null}
          <p className="text-fg-muted mt-2 font-semibold">
            {item.status === "unknown"
              ? t(`media.kinds.${item.type}`)
              : t("media.summary", {
                  kind: t(`media.kinds.${item.type}`),
                  status: t(`media.status.${item.status}`),
                })}
          </p>
          {item.genres.length > 0 ? (
            <ul
              aria-label={t("media.genres")}
              className="mt-3 flex flex-wrap gap-2"
            >
              {item.genres.map((genre) => (
                <li
                  key={genre}
                  className="border-border bg-surface-raised text-fg-muted rounded-full border px-2.5 py-0.5 text-sm font-semibold"
                >
                  {item.library.signedIn ? (
                    // A plain link: the library has its own security policy (ADR-018). A visitor
                    // has no library, so for them it stays a label.
                    <a
                      href={`/library?genre=${genre}`}
                      className="hover:text-link-hover focus-visible:outline-accent rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {t(`genres.${genre}`)}
                    </a>
                  ) : (
                    t(`genres.${genre}`)
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          <h2 className="mt-6 text-xl font-semibold">{t("media.synopsis")}</h2>
          {item.synopsis ? (
            <p lang={item.synopsisLocale} className="mt-2">
              {item.synopsis}
            </p>
          ) : (
            <p className="text-fg-muted mt-2">{t("media.noSynopsis")}</p>
          )}

          {item.source ? (
            <p className="mt-4">
              <a
                href={item.source.url}
                rel="noreferrer"
                className={externalLinkClass}
              >
                {t(`media.viewOn.${item.source.name}`)}
              </a>
            </p>
          ) : null}

          <div className="mt-6">
            {item.library.signedIn ? (
              <TitleLibrary
                id={item.id}
                title={item.title}
                entry={item.library}
              />
            ) : (
              <a href={item.library.signInPath} className={linkClass}>
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

      {item.related.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">{t("media.otherFormats")}</h2>
          {item.related.map((group) => (
            <div key={group.format} className="mt-3">
              <h3 className="font-semibold">
                {t(`media.formats.${group.format}`)}
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-6">
                {group.items.map((related) => (
                  <li key={related.qid}>
                    {related.href ? (
                      <Link to={related.href} className={textLinkClass}>
                        {related.label}
                      </Link>
                    ) : (
                      related.label
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-fg-muted mt-3 text-sm">
            <Trans
              i18nKey="media.relationsSource"
              components={{
                wikidata: <WikidataLink />,
              }}
            />
          </p>
        </section>
      ) : null}

      <p className="text-fg-muted mt-10 text-sm">
        <Trans
          i18nKey="media.sources"
          values={{
            source: item.source?.label ?? "TMDB",
          }}
          components={{
            credits: <Link to="/credits" className={textLinkClass} />,
          }}
        />
      </p>
    </main>
  );
}
