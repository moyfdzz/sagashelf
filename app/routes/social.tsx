import { useTranslation } from "react-i18next";
import { Form, Link, type ShouldRevalidateFunctionArgs } from "react-router";

import type { Route } from "./+types/social";
import { FeedEntry } from "~/components/FeedEntry";
import { PersonRow } from "~/components/PersonRow";
import { inputClass, linkClass, primaryButtonClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { formatFeedCursor, parseFeedCursor, readFeed } from "~server/db/feed";

import {
  normalizePeopleQuery,
  peopleQueryMaxLength,
  peopleQueryMinLength,
  searchPeople,
} from "~server/db/people-search";
import { personCard } from "~server/db/person";
import { mergePrivateHeaders } from "~server/http/cache";
import { rateLimit } from "~server/rate-limit";
import { getDb, getSearchLimiter } from "~server/runtime-env";
import { socialBackPath } from "~server/social/back";
import { feedItems, type FeedItem } from "~server/social/feed-item";
import { likeAction } from "~server/social/like-action";

export type { FeedItem };

type Search =
  | { status: "idle" | "too_short" | "rate_limited"; people: [] }
  | { status: "results"; people: ReturnType<typeof personCard>[] };

/**
 * The search of people (SAG-115): only a real search reads the database and counts against the
 * limit. Over the limit the search says so and the feed below still shows.
 */
async function searchOf(
  request: Request,
  userId: string,
  raw: string,
): Promise<Search> {
  const query = normalizePeopleQuery(raw);
  const length = [...query].length;
  if (length === 0) return { status: "idle", people: [] };
  if (length < peopleQueryMinLength) return { status: "too_short", people: [] };
  if (length > peopleQueryMaxLength) return { status: "results", people: [] };

  const limited = await rateLimit(
    getSearchLimiter(),
    request,
    `people-search:${userId}`,
  );
  if (limited) return { status: "rate_limited", people: [] };

  const people = await searchPeople(await getDb(), userId, query);
  return { status: "results", people: people.map(personCard) };
}

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  const user = await requireUser(args);
  const { t } = getInstance(context);
  const title = t("app.pageTitle", { title: t("social.title") });
  const params = new URL(request.url).searchParams;

  const raw = (params.get("q") ?? "").trim();
  // Only as much as a username can be goes back into the field.
  const q = [...raw].slice(0, peopleQueryMaxLength + 1).join("");
  const before = parseFeedCursor(params.get("before"));
  const locale = getLocale(context) === "en" ? "en" : "es";

  const [search, feed] = await Promise.all([
    searchOf(request, user.id, raw),
    getDb().then((db) => readFeed(db, user.id, locale, before)),
  ]);

  return {
    title,
    q,
    ...search,
    feed: {
      items: feedItems(feed.events),
      next: feed.next ? formatFeedCursor(feed.next) : null,
      // Not the first page: the page offers a way back to the newest.
      older: before !== null,
    },
  };
}

// What the page shows depends on who is looking, so a shared cache never keeps it.
export const headers = mergePrivateHeaders;

// The like button keeps its own count from the answer: reading the page again would repeat the
// search of people and spend its limit on every like.
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return formMethod === "POST" ? false : defaultShouldRevalidate;
}

/**
 * Likes an event of the feed or takes the like back (SAG-22), as the person of the session. A form
 * sent without JavaScript goes back to the page of the feed it came from.
 */
export function action(args: Route.ActionArgs) {
  return likeAction(args, (request) =>
    socialBackPath(request.headers.get("Referer"), new URL(request.url).origin),
  );
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function Social({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { q, status, people, feed } = loaderData;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t("social.title")}</h1>
      <p className="text-fg-muted mt-2">{t("social.description")}</p>

      <Form method="get" role="search" className="mt-6">
        <label htmlFor="people-search" className="font-semibold">
          {t("social.inputLabel")}
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id="people-search"
            type="search"
            name="q"
            defaultValue={q}
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} min-w-0 flex-1 basis-48`}
          />
          <button type="submit" className={primaryButtonClass}>
            {t("social.submit")}
          </button>
        </div>
      </Form>

      {status === "idle" ? (
        <p className="text-fg-muted mt-6">
          {t("social.prompt", { count: peopleQueryMinLength })}
        </p>
      ) : null}
      {status === "too_short" ? (
        <p role="status" className="text-fg-muted mt-6">
          {t("social.tooShort", { count: peopleQueryMinLength })}
        </p>
      ) : null}
      {status === "rate_limited" ? (
        <p role="status" className="text-fg-muted mt-6">
          {t("social.rateLimited")}
        </p>
      ) : null}
      {status === "results" && people.length === 0 ? (
        <p role="status" className="text-fg-muted mt-6">
          {t("social.empty", { query: q })}
        </p>
      ) : null}
      {people.length > 0 ? (
        <ul aria-label={t("social.resultsLabel")} className="mt-6 space-y-3">
          {people.map((person) => (
            <PersonRow key={person.username} person={person} />
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="feed-title" className="mt-12">
        <h2 id="feed-title" className="text-2xl font-bold">
          {t("feed.title")}
        </h2>
        <p className="text-fg-muted mt-2">{t("feed.description")}</p>
        {feed.items.length === 0 ? (
          <p className="text-fg-muted mt-6">
            {feed.older ? t("feed.noOlder") : t("feed.empty")}
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {feed.items.map((item) => (
              <FeedEntry key={item.id} item={item} />
            ))}
          </ul>
        )}
        {feed.next || feed.older ? (
          <nav
            aria-label={t("feed.pagesLabel")}
            className="mt-6 flex flex-wrap justify-between gap-3"
          >
            {feed.older ? (
              <Link to="/social" className={linkClass}>
                {t("feed.newest")}
              </Link>
            ) : (
              <span />
            )}
            {feed.next ? (
              <Link
                to={`/social?${new URLSearchParams({ before: feed.next })}`}
                className={linkClass}
              >
                {t("feed.older")}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
