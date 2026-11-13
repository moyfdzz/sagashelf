import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data } from "react-router";

import type { Route } from "./+types/admin.stats";
import { AdminNav } from "~/components/AdminNav";
import { ClerkSession } from "~/components/ClerkSession";
import { OverviewPanel } from "~/components/admin/OverviewPanel";
import { getInstance } from "~/middleware/i18next";
import { requireRole } from "~server/auth/require";
import {
  getAdminOverview,
  type AdminOverview,
} from "~server/db/admin-overview";
import { privateRouteHeaders } from "~server/http/cache";
import { getClerkKeys, getDb } from "~server/runtime-env";

/** The numbers of the overview, as the loader gives them (the components cannot import `server/`). */
export type { AdminOverview };

export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const overview = await getAdminOverview(await getDb(), new Date());
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.stats.title") }),
    publishableKey: keys.publishableKey,
    overview,
  }));
}

// The numbers of the administration are never kept by a shared cache, and not indexed.
export const headers = privateRouteHeaders;

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function AdminStats({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-4xl px-4 py-10">
        <AdminNav current="stats" />
        <h1 className="text-3xl font-bold">{t("admin.stats.title")}</h1>
        <p className="text-fg-muted mt-2">{t("admin.stats.description")}</p>
        <OverviewPanel overview={loaderData.overview} />
      </main>
    </ClerkSession>
  );
}
