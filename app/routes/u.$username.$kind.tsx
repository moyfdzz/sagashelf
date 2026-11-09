import { useTranslation } from "react-i18next";
import { data } from "react-router";

import type { Route } from "./+types/u.$username.$kind";
import { BackLink } from "~/components/BackLink";
import { PersonRow } from "~/components/PersonRow";
import { ProfilePagination } from "~/components/ProfilePagination";
import { getInstance } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import {
  listFollowers,
  listFollowing,
  listFriends,
  maxPage,
} from "~server/db/people-lists";
import { personCard } from "~server/db/person";
import { findViewableProfile } from "~server/db/profile-lookup";
import { getDb } from "~server/runtime-env";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { pageParam } from "~server/http/page-param";
import { usernameShape } from "~server/account/profile-schema";

const kinds = ["followers", "following", "friends"] as const;
type Kind = (typeof kinds)[number];
const isKind = (value: string): value is Kind =>
  (kinds as readonly string[]).includes(value);

const notFound = () => data(null, { status: 404, headers: privateHeaders });

const lists = {
  followers: listFollowers,
  following: listFollowing,
  friends: listFriends,
} as const;

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  if (!usernameShape.test(params.username) || !isKind(params.kind)) {
    throw notFound();
  }

  const db = await getDb();
  const viewer = await getOptionalUser(args);
  const viewerId = viewer?.id ?? null;
  const page = pageParam(request, maxPage);
  // The same rule as the profile: a person who may not see the profile gets nothing from its lists,
  // and the answer is the same 404 as for a profile that does not exist (ADR-031).
  const found = await findViewableProfile(db, viewerId, params.username);
  const list = found
    ? await lists[params.kind](db, viewerId, params.username, page, found)
    : null;
  if (!found || !list) throw notFound();

  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", {
      title: t("profile.people.pageTitle", {
        kind: t(`profile.people.${params.kind}`),
        username: found.owner.username,
      }),
    }),
    kind: params.kind,
    username: found.owner.username,
    page,
    hasMore: list.hasMore,
    people: list.people.map(personCard),
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

export default function People({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { kind, username, people, page, hasMore } = loaderData;
  const base = `/u/${encodeURIComponent(username)}`;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold break-words">
        {t(`profile.people.${kind}`)}
      </h1>
      <p className="text-fg-muted mt-1 break-words">
        {t("profile.handle", { username })}
      </p>
      <p className="mt-4">
        <BackLink to={base} router>
          {t("profile.people.back")}
        </BackLink>
      </p>

      {people.length === 0 ? (
        <p className="text-fg-muted mt-8">{t("profile.people.empty")}</p>
      ) : (
        <ul aria-label={t("profile.people.label")} className="mt-6 space-y-3">
          {people.map((person) => (
            <PersonRow key={person.username} person={person} />
          ))}
        </ul>
      )}

      <ProfilePagination
        page={page}
        hasMore={hasMore}
        pathTo={(toPage) => `${base}/${kind}?page=${toPage}`}
      />
    </main>
  );
}
