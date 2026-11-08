import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/lists.new";
import { ClerkSession } from "~/components/ClerkSession";
import { ListFields, type ListValues } from "~/components/lists/ListFields";
import { linkClass, primaryButtonClass } from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { requireUser } from "~server/auth/require";
import { countOwnLists } from "~server/db/lists";
import { readForm } from "~server/http/body";
import { mergePrivateHeaders, privateHeaders } from "~server/http/cache";
import { checkWrite } from "~server/http/write-guard";
import { runCreateList } from "~server/lists/actions";
import {
  listVisibilities,
  maxListDescription,
  maxLists,
  maxListsFormBytes,
  maxListTitle,
} from "~server/lists/schema";
import { rateLimit } from "~server/rate-limit";
import { getClerkKeys, getDb, getWriteLimiter } from "~server/runtime-env";

const noValues: ListValues = { title: "", description: "", visibility: "" };

export async function loader(args: Route.LoaderArgs) {
  const user = await requireUser(args);
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const made = await countOwnLists(await getDb(), user.id);
  const { t } = getInstance(args.context);
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("lists.new.title") }),
    publishableKey: keys.publishableKey,
    atLimit: made >= maxLists,
    maxLists,
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
 * Creates a list for the person of the session and goes to its page. The checks come first and in
 * this order: the size and the `Origin`, who is writing, the rate limit, and then the form. A form
 * that was refused comes back with what was written. The work is in `runCreateList`.
 */
export async function action(args: Route.ActionArgs) {
  const { request } = args;

  // A page on another site must not be able to make a list in somebody's name.
  const unsafe = checkWrite(request, maxListsFormBytes);
  if (unsafe) return fail(unsafe === "too_large" ? 413 : 403);

  const user = await requireUser(args);
  const limited = await rateLimit(
    getWriteLimiter(),
    request,
    `lists:${user.id}`,
  );
  if (limited) return limited;

  const result = await runCreateList(
    await getDb(),
    user.id,
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

export default function NewList({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { t } = useTranslation();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const values =
    actionData && "values" in actionData ? actionData.values : noValues;

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p>
          {/* A page of the session: a plain anchor (ADR-018). Tall enough to tap on a phone. */}
          <a href="/lists" className={`${linkClass} inline-block py-2.5`}>
            {t("lists.new.back")}
          </a>
        </p>
        <h1 className="mt-4 text-3xl font-bold">{t("lists.new.title")}</h1>
        <p className="text-fg-muted mt-2">{t("lists.new.intro")}</p>

        {loaderData.atLimit ? (
          <p
            role="status"
            className="border-input-edge bg-surface mt-6 rounded-md border px-4 py-3 font-semibold"
          >
            {t("lists.errors.limit", { max: loaderData.maxLists })}
          </p>
        ) : (
          <Form method="post" reloadDocument className="mt-6 space-y-6">
            <input type="hidden" name="intent" value="create" />
            <ListFields
              idPrefix="new"
              values={values}
              error={error}
              levels={loaderData.levels}
              maxTitle={loaderData.maxTitle}
              maxDescription={loaderData.maxDescription}
            />
            {error ? (
              <p
                role="alert"
                className="text-danger-text text-sm font-semibold"
              >
                {t(`lists.errors.${error}`, { max: loaderData.maxLists })}
              </p>
            ) : null}
            <button type="submit" className={primaryButtonClass}>
              {t("lists.new.submit")}
            </button>
          </Form>
        )}
      </main>
    </ClerkSession>
  );
}
