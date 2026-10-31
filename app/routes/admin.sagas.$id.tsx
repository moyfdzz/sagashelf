import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/admin.sagas.$id";
import { ClerkSession } from "~/components/ClerkSession";
import {
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallButtonClass,
  textLinkClass,
} from "~/lib/ui";
import { getInstance } from "~/middleware/i18next";
import { readAdminWrite } from "~server/auth/admin-write";
import { requireRole } from "~server/auth/require";
import {
  addSagaMember,
  getSagaForAdmin,
  moveSagaMember,
  removeSagaMember,
  renameSaga,
  setSagaStatus,
} from "~server/db/sagas-admin";
import {
  asAdminError,
  maxAdminFormBytes,
  sagaActionSchema,
} from "~server/sagas/admin-schema";
import { getClerkKeys, getDb } from "~server/runtime-env";

const idSchema = z.uuid();

export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const id = idSchema.safeParse(args.params.id);
  if (!id.success) throw data(null, { status: 404 });
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const page = await getSagaForAdmin(await getDb(), id.data);
  if (!page) throw data(null, { status: 404 });

  const { t } = getInstance(args.context);
  const error = asAdminError(
    new URL(args.request.url).searchParams.get("error"),
  );
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.sagas.title") }),
    publishableKey: keys.publishableKey,
    error,
    saga: page.saga,
    members: page.members,
  }));
}

/**
 * One change to one saga: publish, unpublish, rename, add a work, remove one or move one. The
 * person is the administrator of the session and the saga is the one in the address. Every answer
 * is a redirect back to the page (with the reason in the address when the change did not happen),
 * so the page works without JavaScript.
 */
export async function action(args: Route.ActionArgs) {
  const { user, form } = await readAdminWrite(args, "sagas", maxAdminFormBytes);
  const id = idSchema.safeParse(args.params.id);
  if (!id.success) throw data(null, { status: 404 });
  const back = (error?: string) =>
    redirect(`/admin/sagas/${id.data}${error ? `?error=${error}` : ""}`, {
      status: 303,
    });

  const parsed = sagaActionSchema.safeParse(form);
  if (!parsed.success) return back("invalid_request");
  const action = parsed.data;
  const db = await getDb();

  switch (action.intent) {
    case "publish":
    case "unpublish": {
      const status = action.intent === "publish" ? "published" : "draft";
      return (await setSagaStatus(db, id.data, status, user.id))
        ? back()
        : back("not_found");
    }
    case "rename":
      return (await renameSaga(
        db,
        id.data,
        { es: action.titleEs, en: action.titleEn },
        user.id,
      ))
        ? back()
        : back("not_found");
    case "add": {
      const result = await addSagaMember(db, id.data, action.qid, user.id);
      if (!result.found) return back("not_found");
      return result.added ? back() : back("already_there");
    }
    case "remove":
      return (await removeSagaMember(db, id.data, action.qid, user.id))
        ? back()
        : back("not_found");
    case "move":
      return (await moveSagaMember(
        db,
        id.data,
        action.qid,
        action.direction,
        user.id,
      ))
        ? back()
        : back("nothing_to_move");
  }
}

// A page with an administrator's work is never kept by a shared cache, and not indexed.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** A small form with one button, for a change that needs no field of its own. */
function ChangeForm({
  intent,
  qid,
  direction,
  label,
  ariaLabel,
  className,
}: {
  intent: string;
  qid?: string;
  direction?: "up" | "down";
  label: string;
  ariaLabel?: string;
  className: string;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      {qid ? <input type="hidden" name="qid" value={qid} /> : null}
      {direction ? (
        <input type="hidden" name="direction" value={direction} />
      ) : null}
      <button type="submit" aria-label={ariaLabel} className={className}>
        {label}
      </button>
    </Form>
  );
}

export default function AdminSaga({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "es";
  const other = lang === "en" ? "es" : "en";
  const { saga, members } = loaderData;
  const published = saga.status === "published";

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <p>
          <Link to="/admin/sagas" className={textLinkClass}>
            {t("admin.sagas.edit.back")}
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-bold">
          {saga.titles[lang] || saga.title}
        </h1>
        <p className="text-fg-muted mt-2 font-semibold">
          {t(`admin.sagas.status.${saga.status}`)}
          <span className="ml-2 font-normal">
            {t(`admin.sagas.origin.${saga.origin}`)}
          </span>
        </p>

        {loaderData.error ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`admin.errors.${loaderData.error}`)}
          </p>
        ) : null}

        <section aria-labelledby="admin-saga-state" className="mt-6">
          <h2 id="admin-saga-state" className="text-xl font-semibold">
            {t("admin.sagas.edit.state")}
          </h2>
          <p className="mt-2">
            {published
              ? t("admin.sagas.edit.publishedNote")
              : t("admin.sagas.edit.draftNote")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {published ? (
              <ChangeForm
                intent="unpublish"
                label={t("admin.sagas.edit.unpublish")}
                className={secondaryButtonClass}
              />
            ) : (
              <ChangeForm
                intent="publish"
                label={t("admin.sagas.edit.publish")}
                className={primaryButtonClass}
              />
            )}
            {published ? (
              // A plain link: the public page has a policy of its own, which only a new document
              // gets.
              <a href={`/sagas/${saga.slug}`} className={textLinkClass}>
                {t("admin.sagas.edit.viewPublic")}
              </a>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="admin-saga-names" className="mt-8">
          <h2 id="admin-saga-names" className="text-xl font-semibold">
            {t("admin.sagas.edit.names")}
          </h2>
          <Form method="post" className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="rename" />
            <label className="block">
              <span className="font-semibold">
                {t("admin.sagas.create.titleEs")}
              </span>
              <input
                name="titleEs"
                required
                maxLength={80}
                defaultValue={saga.titles.es ?? saga.title}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="font-semibold">
                {t("admin.sagas.create.titleEn")}
              </span>
              <input
                name="titleEn"
                required
                maxLength={80}
                defaultValue={saga.titles.en ?? saga.title}
                className={inputClass}
              />
            </label>
            <p className="text-fg-muted text-sm sm:col-span-2">
              {t("admin.sagas.edit.slug", { slug: saga.slug })}
            </p>
            <div className="sm:col-span-2">
              <button type="submit" className={secondaryButtonClass}>
                {t("admin.sagas.edit.saveNames")}
              </button>
            </div>
          </Form>
        </section>

        <section aria-labelledby="admin-saga-members" className="mt-8">
          <h2 id="admin-saga-members" className="text-xl font-semibold">
            {t("admin.sagas.edit.members.title")}
          </h2>
          {members.length === 0 ? (
            <p className="text-fg-muted mt-2">
              {t("admin.sagas.edit.members.empty")}
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {members.map((member, index) => {
                const name =
                  member.labels[lang] || member.labels[other] || member.qid;
                return (
                  <li
                    key={member.qid}
                    className="border-border bg-surface-raised flex flex-wrap items-center gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold break-words">{name}</p>
                      <p className="text-fg-muted text-sm">
                        {member.format
                          ? t(
                              `media.formats.${member.format === "franchise" ? "other" : member.format}`,
                            )
                          : t("admin.sagas.edit.members.pending")}
                        {member.year ? (
                          <span className="ml-2">
                            {t("search.year", { year: member.year })}
                          </span>
                        ) : null}
                        <span className="ml-2">{member.qid}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {index > 0 ? (
                        <ChangeForm
                          intent="move"
                          qid={member.qid}
                          direction="up"
                          label={t("admin.sagas.edit.members.up")}
                          ariaLabel={t("admin.sagas.edit.members.upLabel", {
                            name,
                          })}
                          className={smallButtonClass}
                        />
                      ) : null}
                      {index < members.length - 1 ? (
                        <ChangeForm
                          intent="move"
                          qid={member.qid}
                          direction="down"
                          label={t("admin.sagas.edit.members.down")}
                          ariaLabel={t("admin.sagas.edit.members.downLabel", {
                            name,
                          })}
                          className={smallButtonClass}
                        />
                      ) : null}
                      <ChangeForm
                        intent="remove"
                        qid={member.qid}
                        label={t("admin.sagas.edit.members.remove")}
                        ariaLabel={t("admin.sagas.edit.members.removeLabel", {
                          name,
                        })}
                        className={smallButtonClass}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby="admin-saga-add" className="mt-8">
          <h2 id="admin-saga-add" className="text-xl font-semibold">
            {t("admin.sagas.edit.add.title")}
          </h2>
          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="add" />
            <label className="block">
              <span className="font-semibold">
                {t("admin.sagas.edit.add.qid")}
              </span>
              <input
                name="qid"
                required
                maxLength={200}
                autoComplete="off"
                className={inputClass}
              />
            </label>
            <p className="text-fg-muted text-sm">
              {t("admin.sagas.edit.add.hint")}
            </p>
            <button type="submit" className={secondaryButtonClass}>
              {t("admin.sagas.edit.add.submit")}
            </button>
          </Form>
        </section>
      </main>
    </ClerkSession>
  );
}
