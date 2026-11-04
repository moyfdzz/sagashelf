import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/notifications";
import { ClerkSession } from "~/components/ClerkSession";
import { useFormatters } from "~/lib/format";
import { secondaryButtonClass, linkClass } from "~/lib/ui";
import { getInstance, getLocale } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
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

// The form has an intent and at most one id. Anything bigger is not from this page.
const maxFormBytes = 1024;

// Pages and answers that carry a person's data are never kept by a shared cache.
const privateHeaders = { "Cache-Control": "private, no-store" };

const formSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("read"), id: z.uuid() }),
  z.strictObject({ intent: z.literal("all") }),
]);

// Each code has its text in app/locales, under notifications.errors.
type ErrorCode = "not_found" | "invalid_request";

const fail = (error: ErrorCode, status: number) =>
  data({ ok: false as const, error }, { status, headers: privateHeaders });

// Answering before the body is read leaves it open (see settings.profile.tsx).
async function answerWithoutReading<T>(request: Request, response: T) {
  await request.arrayBuffer().catch(() => undefined);
  return response;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader(args: Route.LoaderArgs) {
  // Sends a visitor without a session to sign in, and refuses an account with no local row.
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const db = await getDb();
  const [rows, unread] = await Promise.all([
    listNotifications(db, user.id),
    countUnread(db, user.id),
  ]);

  const { t } = getInstance(args.context);
  const locale = getLocale(args.context) === "en" ? "en" : "es";
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("notifications.title") }),
    publishableKey: keys.publishableKey,
    unread,
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
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  const merged = new Headers(loaderHeaders);
  actionHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") merged.append(key, value);
    else merged.set(key, value);
  });
  merged.set("Cache-Control", "private, no-store");
  return merged;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    // A page about one person's account has nothing to show a search engine.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function action(args: Route.ActionArgs) {
  const { request } = args;

  if (Number(request.headers.get("Content-Length") ?? 0) > maxFormBytes) {
    return answerWithoutReading(request, fail("invalid_request", 413));
  }

  // A page on another site must not be able to mark somebody's alerts as read.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return answerWithoutReading(request, fail("invalid_request", 403));
  }

  // The person is the one in the verified session, never a field of the form.
  const user = await requireUser(args);

  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `notifications:${user.id}`,
  );
  if (limited) return answerWithoutReading(request, limited);

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
  const { items, unread } = loaderData;

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
        </div>
        {error ? (
          <p role="alert" className="text-danger-fg mt-3 font-semibold">
            {t(`notifications.errors.${error}`)}
          </p>
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
