import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";

import type { Route } from "./+types/u.$username.lists.$id";
import { BackLink } from "~/components/BackLink";
import { linkClass, secondaryLinkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { usernameShape } from "~server/account/profile-schema";
import { getOptionalUser } from "~server/auth/require";
import { findViewableProfile } from "~server/db/profile-lookup";
import { getViewableList, listViewableItems } from "~server/db/profile-lists";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { asListId } from "~server/lists/actions";
import { listTitleView } from "~server/lists/title-view";
import { getDb } from "~server/runtime-env";

// A list that does not exist, a bad id, a list the viewer may not see, a profile that may not be
// seen, an erased account and a block all get this same answer (ADR-031, ADR-045).
const notFound = () => data(null, { status: 404, headers: privateHeaders });

export async function loader(args: Route.LoaderArgs) {
  const { params, context } = args;
  const listId = asListId(params.id);
  if (!usernameShape.test(params.username) || !listId) throw notFound();

  const db = await getDb();
  const viewer = await getOptionalUser(args);
  const found = await findViewableProfile(
    db,
    viewer?.id ?? null,
    params.username,
  );
  if (!found) throw notFound();
  const { owner, relationship } = found;

  // The data functions work out which levels of list this viewer may see from who they are and the
  // level of the profile (the strictest of the list and the profile, ADR-045).
  const viewing = { relationship, profileLevel: owner.privacy };
  const locale = getLocale(context) === "en" ? "en" : "es";
  // Both statements filter by those levels, so a list the viewer may not see gives no titles
  // either, and the 404 below drops them. Asking together saves a round trip.
  const [list, items] = await Promise.all([
    getViewableList(db, owner.id, listId, viewing),
    listViewableItems(db, owner.id, listId, viewing, locale),
  ]);
  if (!list) throw notFound();

  const { t } = getInstance(context);
  return {
    title: t("app.pageTitle", {
      title: t("profile.lists.pageTitle", {
        list: list.title,
        username: owner.username,
      }),
    }),
    username: owner.username,
    name: owner.displayName ?? owner.username,
    isOwner: relationship === "owner",
    list: {
      id: list.id,
      title: list.title,
      description: list.description,
      items: list.items,
    },
    titles: items.map(listTitleView),
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

export default function ProfileList({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { list, titles, username, name, isOwner } = loaderData;
  const profile = `/u/${encodeURIComponent(username)}`;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <p>
        <BackLink to={profile} router>
          {t("profile.lists.back")}
        </BackLink>
      </p>
      <h1 className="mt-4 text-3xl font-bold break-words">{list.title}</h1>
      <p className="text-fg-muted mt-2 break-words">
        {t("profile.lists.by")}{" "}
        <Link to={profile} className={linkClass}>
          {name}
        </Link>
        <span className="ml-2">
          {t("lists.card.items", { count: list.items })}
        </span>
      </p>
      {list.description ? (
        <p className="mt-4 max-w-prose break-words whitespace-pre-line">
          {list.description}
        </p>
      ) : null}
      {isOwner ? (
        <p className="mt-4">
          {/* A page of the session: a plain anchor (ADR-018). */}
          <a href={`/lists/${list.id}`} className={secondaryLinkClass}>
            {t("profile.lists.edit")}
          </a>
        </p>
      ) : null}

      {titles.length === 0 ? (
        <p className="text-fg-muted mt-6">{t("profile.lists.noTitles")}</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {titles.map((item) => (
            <li
              key={item.mediaId}
              className="border-border bg-surface-raised rounded-md border p-4"
            >
              <p className="font-semibold break-words">
                {item.href ? (
                  <Link to={item.href} className={linkClass}>
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}
              </p>
              <p className="text-fg-muted mt-1 text-sm">
                {item.type ? t(`media.kinds.${item.type}`) : null}
                {item.year ? (
                  <span className={item.type ? "ml-2" : undefined}>
                    {item.year}
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
