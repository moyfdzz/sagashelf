import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/admin.sagas";
import { ClerkSession } from "~/components/ClerkSession";
import { getInstance } from "~/middleware/i18next";
import { readAdminWrite } from "~server/auth/admin-write";
import { requireRole } from "~server/auth/require";
import { createSaga, listSagasForAdmin } from "~server/db/sagas-admin";
import { slugify } from "~server/media/slug";
import {
  asAdminError,
  createSagaSchema,
  maxAdminFormBytes,
} from "~server/sagas/admin-schema";
import { getClerkKeys, getDb } from "~server/runtime-env";
import { inputClass, primaryButtonClass, textLinkClass } from "~/lib/ui";

export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const error = asAdminError(
    new URL(args.request.url).searchParams.get("error"),
  );
  const sagas = await listSagasForAdmin(await getDb());
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.sagas.title") }),
    publishableKey: keys.publishableKey,
    error,
    sagas,
  }));
}

// Creates a draft that only an administrator sees, and opens it to add its works.
export async function action(args: Route.ActionArgs) {
  const { user, form } = await readAdminWrite(args, "sagas", maxAdminFormBytes);
  const parsed = createSagaSchema.safeParse(form);
  if (!parsed.success) {
    return redirect("/admin/sagas?error=invalid_request", { status: 303 });
  }
  const { titleEs, titleEn } = parsed.data;
  const id = await createSaga(await getDb(), {
    // The address comes from the English name and does not change afterwards.
    slug: slugify(titleEn),
    titles: { es: titleEs, en: titleEn },
    actorId: user.id,
  });
  return redirect(id ? `/admin/sagas/${id}` : "/admin/sagas?error=slug_taken", {
    status: 303,
  });
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

export default function AdminSagas({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "es";

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold">{t("admin.sagas.title")}</h1>
        <p className="text-fg-muted mt-2">{t("admin.sagas.description")}</p>

        {loaderData.error ? (
          <p
            role="alert"
            className="border-danger-edge bg-danger-bg text-danger-fg mt-4 rounded-md border px-4 py-3 font-semibold"
          >
            {t(`admin.errors.${loaderData.error}`)}
          </p>
        ) : null}

        <section aria-labelledby="admin-sagas-create" className="mt-8">
          <h2 id="admin-sagas-create" className="text-xl font-semibold">
            {t("admin.sagas.create.title")}
          </h2>
          <Form method="post" className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <label className="block">
              <span className="font-semibold">
                {t("admin.sagas.create.titleEs")}
              </span>
              <input
                name="titleEs"
                required
                maxLength={80}
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
                className={inputClass}
              />
            </label>
            <p className="text-fg-muted text-sm sm:col-span-2">
              {t("admin.sagas.create.hint")}
            </p>
            <div className="sm:col-span-2">
              <button type="submit" className={primaryButtonClass}>
                {t("admin.sagas.create.submit")}
              </button>
            </div>
          </Form>
        </section>

        <section aria-labelledby="admin-sagas-list" className="mt-10">
          <h2 id="admin-sagas-list" className="text-xl font-semibold">
            {t("admin.sagas.list.title")}
          </h2>
          {loaderData.sagas.length === 0 ? (
            <p className="text-fg-muted mt-2">{t("admin.sagas.list.empty")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {loaderData.sagas.map((saga) => (
                <li
                  key={saga.id}
                  className="border-border bg-surface-raised rounded-md border p-4"
                >
                  <p className="font-semibold">
                    <Link
                      to={`/admin/sagas/${saga.id}`}
                      className={textLinkClass}
                    >
                      {saga.titles[lang] || saga.title}
                    </Link>
                  </p>
                  <p className="text-fg-muted mt-1 text-sm">
                    <span className="font-semibold">
                      {t(`admin.sagas.status.${saga.status}`)}
                    </span>
                    <span className="ml-2">
                      {t(`admin.sagas.origin.${saga.origin}`)}
                    </span>
                    <span className="ml-2">
                      {t("admin.sagas.list.works", { count: saga.members })}
                    </span>
                    {saga.described < saga.members ? (
                      <span className="ml-2">
                        {t("admin.sagas.list.described", {
                          described: saga.described,
                          total: saga.members,
                        })}
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </ClerkSession>
  );
}
