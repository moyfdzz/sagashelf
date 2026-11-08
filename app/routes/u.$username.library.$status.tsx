import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";

import type { Route } from "./+types/u.$username.library.$status";
import { BackLink } from "~/components/BackLink";
import { PosterGrid } from "~/components/PosterGrid";
import { ProfilePagination } from "~/components/ProfilePagination";
import { tabClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { usernameShape } from "~server/account/profile-schema";
import { getOptionalUser } from "~server/auth/require";
import {
  getProfileSectionPage,
  maxSectionPage,
  profileStatuses,
  type ProfileStatus,
} from "~server/db/profile-library";
import { findViewableProfile } from "~server/db/profile-lookup";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { pageParam } from "~server/http/page-param";
import { libraryTypes, type LibraryType } from "~server/library/schema";
import { posterCard } from "~server/media/poster-card";
import { getDb } from "~server/runtime-env";

const notFound = () => data(null, { status: 404, headers: privateHeaders });

const isStatus = (value: string): value is ProfileStatus =>
  (profileStatuses as readonly string[]).includes(value);

const isType = (value: string): value is LibraryType =>
  (libraryTypes as readonly string[]).includes(value);

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  const rawType = new URL(request.url).searchParams.get("type");
  const { status } = params;
  if (
    !usernameShape.test(params.username) ||
    !isStatus(status) ||
    (rawType !== null && !isType(rawType))
  ) {
    throw notFound();
  }
  const type = rawType;

  const db = await getDb();
  const viewer = await getOptionalUser(args);
  // The same rule as the profile: a person who may not see it gets the same 404 as for a profile
  // that does not exist (ADR-031).
  const found = await findViewableProfile(
    db,
    viewer?.id ?? null,
    params.username,
  );
  if (!found) throw notFound();
  const { owner, relationship } = found;

  const page = pageParam(request, maxSectionPage);
  const section = await getProfileSectionPage(
    db,
    owner.id,
    owner.privacy,
    relationship,
    {
      status,
      type,
      page,
      locale: getLocale(context) === "en" ? "en" : "es",
    },
  );

  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", {
      title: t("profile.sectionPage.pageTitle", {
        section: t(`profile.sections.${status}`),
        username: owner.username,
      }),
    }),
    username: owner.username,
    status,
    type,
    page,
    hasMore: section.hasMore,
    tabs: [null, ...libraryTypes].map((tab) => ({
      type: tab,
      count: section.counts[tab ?? "all"],
    })),
    entries: section.entries.map(posterCard),
  };
}

// Pages that depend on who is looking are never kept by a shared cache.
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function ProfileSectionPage({
  loaderData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { username, status, type, page, hasMore, tabs, entries } = loaderData;
  const profilePath = `/u/${encodeURIComponent(username)}`;
  const pathTo = (tab: LibraryType | null, toPage = 1) => {
    const search = new URLSearchParams();
    if (tab) search.set("type", tab);
    if (toPage > 1) search.set("page", String(toPage));
    const query = search.toString();
    return `${profilePath}/library/${status}${query ? `?${query}` : ""}`;
  };

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold break-words">
        {t(`profile.sections.${status}`)}
      </h1>
      <p className="text-fg-muted mt-1 break-words">
        {t("profile.handle", { username })}
      </p>
      <p className="mt-4">
        <BackLink to={profilePath} router>
          {t("profile.people.back")}
        </BackLink>
      </p>

      <nav aria-label={t("library.tabs.label")} className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const active = type === tab.type;
            return (
              <li key={tab.type ?? "all"}>
                <Link
                  to={pathTo(tab.type)}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {t(`library.tabs.${tab.type ?? "all"}`)}{" "}
                  <span className="font-normal">
                    {t("library.badge", { count: tab.count })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {entries.length === 0 ? (
        <p className="text-fg-muted mt-8">{t("profile.sectionPage.empty")}</p>
      ) : (
        <div className="mt-6">
          <PosterGrid entries={entries} />
        </div>
      )}

      <ProfilePagination
        page={page}
        hasMore={hasMore}
        pathTo={(toPage) => pathTo(type, toPage)}
      />
    </main>
  );
}
