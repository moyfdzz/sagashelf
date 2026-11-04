import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";

import type { Route } from "./+types/u.$username.$kind";
import { linkClass, secondaryLinkClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { getOptionalUser } from "~server/auth/require";
import {
  findViewableProfile,
  listFollowers,
  listFollowing,
  listFriends,
  maxPage,
} from "~server/db/social";
import { getDb } from "~server/runtime-env";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";

const usernameShape = /^[^\s/?#%\\]{3,30}$/;

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

/** The page asked for, from `?page=`, a whole number from 1 to the last one that can be asked for. */
function pageOf(request: Request): number {
  const raw = Number(new URL(request.url).searchParams.get("page"));
  return Number.isInteger(raw) && raw >= 1 ? Math.min(raw, maxPage) : 1;
}

export async function loader(args: Route.LoaderArgs) {
  const { params, request, context } = args;
  if (!usernameShape.test(params.username) || !isKind(params.kind)) {
    throw notFound();
  }

  const db = await getDb();
  const viewer = await getOptionalUser(args);
  const viewerId = viewer?.id ?? null;
  const page = pageOf(request);
  // The same rule as the profile: a person who may not see the profile gets nothing from its lists,
  // and the answer is the same 404 as for a profile that does not exist (ADR-031).
  const found = await findViewableProfile(db, viewerId, params.username);
  const list = found
    ? await lists[params.kind](db, viewerId, params.username, page)
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
    people: list.people.map((person) => ({
      username: person.username,
      displayName: person.displayName,
      avatarUrl: person.avatarUrl?.startsWith("https://")
        ? person.avatarUrl
        : null,
    })),
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
        <Link to={base} className={secondaryLinkClass}>
          {t("profile.people.back")}
        </Link>
      </p>

      {people.length === 0 ? (
        <p className="text-fg-muted mt-8">{t("profile.people.empty")}</p>
      ) : (
        <ul aria-label={t("profile.people.label")} className="mt-6 space-y-3">
          {people.map((person) => {
            const shown = person.displayName ?? person.username;
            return (
              <li
                key={person.username}
                className="border-border bg-surface-raised flex items-center gap-3 rounded-md border p-3"
              >
                {person.avatarUrl ? (
                  // The name is written next to it, so a screen reader skips the picture.
                  <span aria-hidden="true" className="shrink-0">
                    <img
                      src={person.avatarUrl}
                      alt={t("profile.avatarAlt", { name: shown })}
                      width={48}
                      height={48}
                      loading="lazy"
                      className="size-12 rounded-full object-cover"
                    />
                  </span>
                ) : (
                  <div
                    aria-hidden="true"
                    className="bg-accent text-accent-fg flex size-12 shrink-0 items-center justify-center rounded-full font-bold"
                  >
                    {shown.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <Link
                    to={`/u/${encodeURIComponent(person.username)}`}
                    className={`${linkClass} break-words`}
                  >
                    {shown}
                  </Link>
                  <p className="text-fg-muted text-sm break-words">
                    {t("profile.handle", { username: person.username })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {page > 1 || hasMore ? (
        <nav
          aria-label={t("profile.people.pagination")}
          className="mt-6 flex flex-wrap items-center gap-3"
        >
          {page > 1 ? (
            <Link
              to={`${base}/${kind}?page=${page - 1}`}
              className={secondaryLinkClass}
            >
              {t("profile.people.previous")}
            </Link>
          ) : null}
          <span className="text-fg-muted">
            {t("profile.people.page", { page })}
          </span>
          {hasMore ? (
            <Link
              to={`${base}/${kind}?page=${page + 1}`}
              className={secondaryLinkClass}
            >
              {t("profile.people.next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
