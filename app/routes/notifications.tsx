import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/notifications";
import { ClerkSession } from "~/components/ClerkSession";
import { useFormatters } from "~/lib/format";
import {
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryLinkClass,
} from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import {
  acceptRequest,
  declineRequest,
  listPendingRequests,
} from "~server/db/follow-requests";
import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
} from "~server/db/notifications";
import { readForm } from "~server/http/body";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";
import { episodeAiredEvent } from "~server/webhooks/events";
import { episodeNotice } from "~server/webhooks/message";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";

// The form has an intent and at most one id. Anything bigger is not from this page.
const maxFormBytes = 1024;

const formSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("read"), id: z.uuid() }),
  z.strictObject({ intent: z.literal("all") }),
  // The follow requests (SAG-108): the person is named by username, and the database decides
  // whether it is a request waiting for the person of the session.
  z.strictObject({
    intent: z.enum(["accept", "accept_back", "decline"]),
    username: z.string().min(3).max(30),
  }),
]);

// Each code has its text in app/locales, under notifications.errors.
type ErrorCode = "not_found" | "request_not_found" | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader(args: Route.LoaderArgs) {
  // Sends a visitor without a session to sign in, and refuses an account with no local row.
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const db = await getDb();
  const [rows, unread, requests] = await Promise.all([
    listNotifications(db, user.id),
    countUnread(db, user.id),
    listPendingRequests(db, user.id),
  ]);

  const { t } = getInstance(args.context);
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("notifications.title") }),
    publishableKey: keys.publishableKey,
    unread,
    // Who asked to follow this person. Only the name and the username: this is a session page, with
    // a narrow policy, so no picture is drawn here.
    requests: requests.map((request) => ({
      username: request.username,
      name: request.displayName ?? request.username,
      canFollowBack: request.canFollowBack,
      createdAt: request.createdAt.toISOString(),
    })),
    // The text is made here, in the language of the page, from the same place as the Discord
    // message. A row that says nothing readable is left out.
    items: rows.flatMap((row) => {
      if (row.type !== episodeAiredEvent) return [];
      const notice = episodeNotice(row.payload, locale);
      if (!notice) return [];
      return [
        {
          id: row.id,
          title: notice.title,
          which: notice.which,
          // The link is to the entry in the library of this person, and only if the id is one.
          href:
            notice.mediaId && uuidPattern.test(notice.mediaId)
              ? `/library/${notice.mediaId}`
              : null,
          createdAt: row.createdAt.toISOString(),
          read: row.readAt !== null,
        },
      ];
    }),
  }));
}

// Pages and answers that carry a person's data are never kept by a shared cache. Set here, for
// the page and for its data requests alike, and the cookie of an answer is kept.
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's account has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to mark somebody's alerts as read.
  const unsafe = checkWrite(request, maxFormBytes);
  if (unsafe) {
    return unsafe === "too_large"
      ? fail("invalid_request", 413)
      : fail("invalid_request", 403);
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `notifications:${user.id}`,
  );
  if (limited) return limited;

  const parsed = formSchema.safeParse(await readForm(request, maxFormBytes));
  if (!parsed.success) return fail("invalid_request", 400);
  const form = parsed.data;
  const db = await getDb();

  switch (form.intent) {
    case "read": {
      if (!(await markRead(db, user.id, form.id))) {
        return fail("not_found", 404);
      }
      return data(
        { ok: true as const, intent: "read" as const },
        { headers: privateHeaders },
      );
    }
    case "all": {
      await markAllRead(db, user.id);
      return data(
        { ok: true as const, intent: "all" as const },
        { headers: privateHeaders },
      );
    }
    case "accept":
    case "accept_back": {
      const found = await acceptRequest(
        db,
        user.id,
        form.username,
        form.intent === "accept_back",
      );
      if (!found) return fail("request_not_found", 404);
      return data(
        { ok: true as const, intent: form.intent },
        { headers: privateHeaders },
      );
    }
    case "decline": {
      if (!(await declineRequest(db, user.id, form.username))) {
        return fail("request_not_found", 404);
      }
      return data(
        { ok: true as const, intent: "decline" as const },
        { headers: privateHeaders },
      );
    }
  }
}

export default function Notifications({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { items, unread, requests } = loaderData;

  const error = actionData?.ok === false ? actionData.error : null;
  const outcome = actionData?.ok === true ? actionData : null;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("notifications.title")}</h1>
        <p className="text-fg-muted mt-2">{t("notifications.description")}</p>

        {/* Always in the page, so a screen reader announces the count and each result. */}
        <div role="status" className="mt-6 space-y-1">
          <p className="font-semibold">
            {unread > 0
              ? t("notifications.unread", { count: unread })
              : t("notifications.none")}
          </p>
          {outcome?.intent === "read" ? (
            <p>{t("notifications.result.read")}</p>
          ) : null}
          {outcome?.intent === "all" ? (
            <p>{t("notifications.result.allRead")}</p>
          ) : null}
          {outcome?.intent === "accept" || outcome?.intent === "accept_back" ? (
            <p>{t(`notifications.requests.result.${outcome.intent}`)}</p>
          ) : null}
          {outcome?.intent === "decline" ? (
            <p>{t("notifications.requests.result.decline")}</p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-danger-fg mt-3 font-semibold">
            {t(`notifications.errors.${error}`)}
          </p>
        ) : null}

        {requests.length > 0 ? (
          <section aria-labelledby="follow-requests" className="mt-8">
            <h2 id="follow-requests" className="text-xl font-bold">
              {t("notifications.requests.title", { count: requests.length })}
            </h2>
            <p className="text-fg-muted mt-1 text-sm">
              {t("notifications.requests.hint")}
            </p>
            <ul className="mt-4 space-y-3">
              {requests.map((request) => (
                <li
                  key={request.username}
                  className="border-border bg-surface-raised rounded-md border p-4"
                >
                  <p className="font-semibold break-words">
                    {/* A plain link: profiles have a policy of their own (ADR-018). */}
                    <a
                      href={`/u/${encodeURIComponent(request.username)}`}
                      className={linkClass}
                    >
                      {request.name}
                    </a>
                    <span className="text-fg-muted ml-2 font-normal">
                      {t("profile.handle", { username: request.username })}
                    </span>
                  </p>
                  <p className="text-fg-muted mt-1 text-sm">
                    {formatDate(new Date(request.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={`/u/${encodeURIComponent(request.username)}`}
                      className={secondaryLinkClass}
                    >
                      {t("notifications.requests.viewProfile")}
                    </a>
                    {(
                      [
                        ["accept", primaryButtonClass],
                        ...(request.canFollowBack
                          ? ([["accept_back", secondaryButtonClass]] as const)
                          : []),
                        ["decline", secondaryButtonClass],
                      ] as const
                    ).map(([intent, className]) => (
                      <Form method="post" key={intent}>
                        <input type="hidden" name="intent" value={intent} />
                        <input
                          type="hidden"
                          name="username"
                          value={request.username}
                        />
                        <button
                          type="submit"
                          disabled={busy}
                          className={className}
                        >
                          {t(`notifications.requests.${intent}`)}
                        </button>
                      </Form>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {unread > 0 ? (
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="all" />
            <button
              type="submit"
              disabled={busy}
              className={secondaryButtonClass}
            >
              {t("notifications.markAll")}
            </button>
          </Form>
        ) : null}

        {items.length === 0 ? (
          <p className="text-fg-muted mt-8">{t("notifications.empty")}</p>
        ) : (
          <ol
            aria-label={t("notifications.listLabel")}
            className="mt-6 space-y-3"
          >
            {items.map((item) => (
              <li
                key={item.id}
                className={`border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border p-4 ${
                  item.read ? "bg-surface" : "bg-surface-raised"
                }`}
              >
                <div className="min-w-0">
                  <p className={item.read ? "" : "font-semibold"}>
                    {item.href ? (
                      // A plain link: the library is a session page with a policy of its own.
                      <a href={item.href} className={linkClass}>
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                    {item.which ? `: ${item.which}` : null}
                  </p>
                  <p className="text-fg-muted mt-1 text-sm">
                    {item.read ? null : (
                      <span className="bg-accent text-accent-fg mr-2 rounded-full px-2 py-0.5 text-xs font-bold">
                        {t("notifications.new")}
                      </span>
                    )}
                    {formatDate(new Date(item.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                {item.read ? null : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="read" />
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      disabled={busy}
                      className={secondaryButtonClass}
                    >
                      {t("notifications.markRead")}
                    </button>
                  </Form>
                )}
              </li>
            ))}
          </ol>
        )}
      </main>
    </ClerkSession>
  );
}
