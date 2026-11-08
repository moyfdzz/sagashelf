import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form } from "react-router";

import type { Route } from "./+types/lists";
import { ClerkSession } from "~/components/ClerkSession";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { ListCard } from "~/components/lists/ListCard";
import { dangerButtonClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { listOwnLists } from "~server/db/lists";
import { mergePrivateHeaders } from "~server/http/cache";
import { asListId } from "~server/lists/actions";
import { asListNotice, maxLists } from "~server/lists/schema";
import { getClerkKeys, getDb } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  // Only the lists of the person of the session: nobody else's are ever asked for.
  const lists = await listOwnLists(await getDb(), user.id);
  const { t } = getInstance(args.context);
  const params = new URL(args.request.url).searchParams;
  // The list whose deleting is being confirmed, if the address names one of the person's own.
  const asked = asListId(params.get("confirm"));
  const confirming = lists.find((list) => list.id === asked) ?? null;
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("lists.title") }),
    publishableKey: keys.publishableKey,
    notice: asListNotice(params.get("notice")),
    confirming: confirming && { id: confirming.id, title: confirming.title },
    lists: lists.map(({ id, title, description, visibility, items }) => ({
      id,
      title,
      description,
      visibility,
      items,
    })),
    atLimit: lists.length >= maxLists,
    maxLists,
  }));
}

// A page with a person's things is never kept by a shared cache, and not indexed. The lists are
// made at `/lists/new` and changed at `/lists/:id`: this page only reads them (and asks before a
// delete, which is done by the page of the list).
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function Lists({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { lists, atLimit } = loaderData;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t("lists.title")}</h1>
        <p className="text-fg-muted mt-2">{t("lists.intro")}</p>
        {atLimit ? (
          <p className="text-fg-muted mt-4">
            {t("lists.errors.limit", { max: loaderData.maxLists })}
          </p>
        ) : (
          <p className="mt-4">
            {/* A page of the session: a plain anchor, which loads a whole new document (ADR-018). */}
            <a
              href="/lists/new"
              className={`${primaryButtonClass} inline-block`}
            >
              {t("lists.new.link")}
            </a>
          </p>
        )}

        {loaderData.notice ? (
          <p
            role="status"
            className="border-input-edge bg-surface mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`lists.notices.${loaderData.notice}`)}
          </p>
        ) : null}

        {lists.length === 0 ? (
          <p className="text-fg-muted mt-6">{t("lists.empty")}</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {lists.map((list) => (
              <ListCard key={list.id} list={list} />
            ))}
          </ul>
        )}

        {loaderData.confirming ? (
          <ConfirmDialog
            title={t("lists.confirm.title", {
              name: loaderData.confirming.title,
            })}
            message={t("lists.confirm.body")}
            cancelHref="/lists"
            cancelLabel={t("lists.confirm.no")}
          >
            {/* The delete is the one of the page of the list: it asks the owner, and comes back here. */}
            <Form
              method="post"
              action={`/lists/${loaderData.confirming.id}`}
              reloadDocument
            >
              <input type="hidden" name="intent" value="delete" />
              <button type="submit" className={dangerButtonClass}>
                {t("lists.confirm.yes")}
              </button>
            </Form>
          </ConfirmDialog>
        ) : null}
      </main>
    </ClerkSession>
  );
}
