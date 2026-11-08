import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/lists.$id";
import { ClerkSession } from "~/components/ClerkSession";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { ListFields, type ListValues } from "~/components/lists/ListFields";
import { dangerButtonClass, linkClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { getOwnList } from "~server/db/lists";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { asListId, runListAction } from "~server/lists/actions";
import {
  asListNotice,
  listVisibilities,
  maxListDescription,
  maxListsFormBytes,
  maxListTitle,
} from "~server/lists/schema";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";

const notFound = () => data(null, { status: 404, headers: privateHeaders });

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  // A list that is not the person's, or is not there, or has no valid id, is the same answer.
  const id = asListId(args.params.id);
  if (!id) throw notFound();
  const list = await getOwnList(await getDb(), user.id, id);
  if (!list) throw notFound();

  const { t } = getInstance(args.context);
  const params = new URL(args.request.url).searchParams;
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: list.title }),
    publishableKey: keys.publishableKey,
    notice: asListNotice(params.get("notice")),
    confirming: params.get("confirm") === "1",
    list: {
      id: list.id,
      title: list.title,
      description: list.description ?? "",
      visibility: list.visibility,
      items: list.items,
    },
    maxTitle: maxListTitle,
    maxDescription: maxListDescription,
    levels: listVisibilities,
  }));
}

const fail = (status: number) =>
  data(
    { error: "invalid_request" as const },
    { status, headers: privateHeaders },
  );

/**
 * Saves or deletes a list of the person of the session. The checks come first and in this order:
 * the size and the `Origin`, who is writing, the rate limit, and then the form. The id of the list
 * is the one of the address, and the owner in every statement is the one of the session. The work
 * is in `runListAction`.
 */
export async function action(args: Route.ActionArgs) {
  const { request, params } = args;

  // A page on another site must not be able to change a list.
  const unsafe = checkWrite(request, maxListsFormBytes);
  if (unsafe) return fail(unsafe === "too_large" ? 413 : 403);

  const user = await requireUser(args);
  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `lists:${user.id}`,
  );
  if (limited) return limited;

  const id = asListId(params.id);
  if (!id) return fail(404);

  const result = await runListAction(
    await getDb(),
    user.id,
    id,
    await readForm(request, maxListsFormBytes),
  );
  if (result.ok) return redirect(result.to, { status: 303 });
  return data(
    { error: result.error, values: result.values },
    { status: result.status, headers: privateHeaders },
  );
}

// A page with a person's things is never kept by a shared cache, and not indexed.
export const headers = mergePrivateHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function List({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { list } = loaderData;
  const page = `/lists/${list.id}`;
  const error = actionData && "error" in actionData ? actionData.error : null;
  // A refused form comes back with what was written, and otherwise the form has the saved list.
  const values: ListValues =
    actionData && "values" in actionData ? actionData.values : list;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p>
          {/* A back link has no forward arrow, and the padding makes it easy to tap on a phone. */}
          <a href="/lists" className={`${linkClass} inline-block py-2.5`}>
            {t("lists.detail.back")}
          </a>
        </p>
        <h1 className="mt-4 text-3xl font-bold break-words">{list.title}</h1>
        <p className="text-fg-muted mt-2">
          {t("lists.card.items", { count: list.items })}
        </p>

        {loaderData.notice ? (
          <p
            role="status"
            className="border-input-edge bg-surface mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`lists.notices.${loaderData.notice}`)}
          </p>
        ) : null}

        <Form method="post" reloadDocument className="mt-6 space-y-6">
          <input type="hidden" name="intent" value="save" />
          <ListFields
            idPrefix="list"
            values={values}
            error={error}
            levels={loaderData.levels}
            maxTitle={loaderData.maxTitle}
            maxDescription={loaderData.maxDescription}
          />
          {error ? (
            <p role="alert" className="text-danger-text text-sm font-semibold">
              {t(`lists.errors.${error}`)}
            </p>
          ) : null}
          <button type="submit" className={primaryButtonClass}>
            {t("lists.detail.save")}
          </button>
        </Form>

        <section aria-labelledby="titles" className="mt-10">
          <h2 id="titles" className="text-xl font-semibold">
            {t("lists.detail.titles")}
          </h2>
          <p className="text-fg-muted mt-2">{t("lists.detail.noTitles")}</p>
        </section>

        <section aria-labelledby="danger" className="mt-10">
          <h2 id="danger" className="sr-only">
            {t("lists.detail.dangerTitle")}
          </h2>
          {/* A link of the router: the modal opens without loading the page again. */}
          <Link
            to={`${page}?confirm=1`}
            preventScrollReset
            className={`${dangerButtonClass} inline-block`}
          >
            {t("lists.detail.delete")}
          </Link>
        </section>

        {loaderData.confirming ? (
          <ConfirmDialog
            title={t("lists.confirm.title", { name: list.title })}
            message={t("lists.confirm.body")}
            cancelHref={page}
            cancelLabel={t("lists.confirm.no")}
          >
            <Form method="post" reloadDocument>
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
