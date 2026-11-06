import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";

import type { Route } from "./+types/admin.messages";
import { AdminNav } from "~/components/AdminNav";
import { ClerkSession } from "~/components/ClerkSession";
import { MessageCard } from "~/components/contact/MessageCard";
import { getInstance } from "~/middleware/i18next";
import { isContactKind } from "~server/account/contact-schema";
import { readAdminWrite } from "~server/auth/admin-write";
import { requireRole } from "~server/auth/require";
import { listContactMessages } from "~server/db/contact-messages";
import {
  asMessageError,
  asMessageId,
  asMessageNotice,
  maxMessagesFormBytes,
  messageActionSchema,
  runMessageAction,
} from "~server/contact/messages-panel";
import { privateRouteHeaders } from "~server/http/cache";
import { getClerkKeys, getDb } from "~server/runtime-env";

const back = "/admin/messages";

export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const params = new URL(args.request.url).searchParams;
  const messages = await listContactMessages(await getDb());
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.messages.title") }),
    publishableKey: keys.publishableKey,
    notice: asMessageNotice(params.get("notice")),
    error: asMessageError(params.get("error")),
    // The message whose deleting is being confirmed, if the address names one.
    confirmId: asMessageId(params.get("confirm")),
    messages: messages.flatMap((message) =>
      isContactKind(message.kind)
        ? [
            {
              id: message.id,
              kind: message.kind,
              body: message.body,
              replyEmail: message.replyEmail,
              status: message.status,
              username: message.username,
              createdAt: message.createdAt.getTime(),
            },
          ]
        : [],
    ),
  }));
}

/**
 * Does what the administrator asked, as the administrator of the session, and goes back to the
 * list saying how it went. The work is in `runMessageAction`.
 */
export async function action(args: Route.ActionArgs) {
  const { user, form } = await readAdminWrite(
    args,
    "messages",
    maxMessagesFormBytes,
  );
  const parsed = messageActionSchema.safeParse(form);
  if (!parsed.success) {
    return redirect(`${back}?error=invalid_request`, { status: 303 });
  }
  const result = await runMessageAction(await getDb(), user.id, parsed.data);
  return redirect(`${back}?${result}`, { status: 303 });
}

// A page with an administrator's work is never kept by a shared cache, and not indexed.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function AdminMessages({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <AdminNav current="messages" />
        <h1 className="text-3xl font-bold">{t("admin.messages.title")}</h1>
        <p className="text-fg-muted mt-2">{t("admin.messages.description")}</p>

        {loaderData.notice ? (
          <p
            role="status"
            className="border-input-edge bg-surface mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`admin.messages.notices.${loaderData.notice}`)}
          </p>
        ) : null}
        {loaderData.error ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`admin.messages.errors.${loaderData.error}`)}
          </p>
        ) : null}

        {loaderData.messages.length === 0 ? (
          <p className="text-fg-muted mt-6">{t("admin.messages.empty")}</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {loaderData.messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                confirming={loaderData.confirmId === message.id}
              />
            ))}
          </ul>
        )}
      </main>
    </ClerkSession>
  );
}
