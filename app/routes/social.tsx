import { useTranslation } from "react-i18next";
import {
  data,
  Form,
  Link,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { z } from "zod";

import type { Route } from "./+types/social";
import { FeedEntry } from "~/components/FeedEntry";
import { PersonRow } from "~/components/PersonRow";
import { inputClass, linkClass, primaryButtonClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  formatFeedCursor,
  parseFeedCursor,
  readFeed,
  setLike,
} from "~server/db/feed";
import {
  normalizePeopleQuery,
  peopleQueryMaxLength,
  peopleQueryMinLength,
  searchPeople,
} from "~server/db/people-search";
import { personCard } from "~server/db/person";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { rateLimit } from "~server/rate-limit";
import { getDb, getSearchLimiter, getWriteLimiter } from "~server/runtime-env";
import { socialBackPath } from "~server/social/back";
import { feedItems, type FeedItem } from "~server/social/feed-item";

export type { FeedItem };

type Search =
  | { status: "idle" | "too_short"; people: [] }
  | { status: "results"; people: ReturnType<typeof personCard>[] };

/** The search of people (SAG-115): only a real search reads the database and counts against the limit. */
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
  if (limited) throw limited;

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

// The form has an id and a yes or no. Anything bigger is not from this page.
const maxFormBytes = 256;

const likeSchema = z.strictObject({
  activityId: z.uuid(),
  liked: z.enum(["true", "false"]),
});

// Each code has its text in app/locales, under feed.errors.
type ErrorCode = "invalid_request" | "not_found";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

/**
 * Likes an event of the feed or takes the like back (SAG-22), as the person of the session. A form
 * sent without JavaScript goes back to the page of the feed it came from.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to like for someone.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return fail("invalid_request", unsafe === "too_large" ? 413 : 403);
  }

  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `like:${user.id}`,
  );
  if (limited) return limited;

  const parsed = likeSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);

  const liked = parsed.data.liked === "true";
  const result = await setLike(
    await getDb(),
    user.id,
    parsed.data.activityId,
    liked,
  );

  if (request.headers.get("Sec-Fetch-Dest") === "document") {
    return redirect(
      socialBackPath(
        request.headers.get("Referer"),
        new URL(request.url).origin,
      ),
      { status: 303, headers: privateHeaders },
    );
  }
  // An event that is gone, hidden or the person's own all answer the same.
  if (!result) return fail("not_found", 404);
  return data(
    { ok: true as const, liked, likes: result.likes },
    { headers: privateHeaders },
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
