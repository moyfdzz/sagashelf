import { rootAuthLoader } from "@clerk/react-router/server";
import { useTranslation } from "react-i18next";
import { data } from "react-router";

import type { Route } from "./+types/admin.stats.providers";
import { AdminNav } from "~/components/AdminNav";
import { ClerkSession } from "~/components/ClerkSession";
import { ProvidersPanel } from "~/components/admin/ProvidersPanel";
import { StatsNav } from "~/components/admin/StatsNav";
import { getInstance } from "~/middleware/i18next";
import { requireRole } from "~server/auth/require";
import {
  getAdminProviders,
  type AdminProviders,
} from "~server/db/admin-providers";
import { parseTrafficDays, trafficDays } from "~server/db/admin-traffic";
import { privateRouteHeaders } from "~server/http/cache";
import { getClerkKeys, getDb } from "~server/runtime-env";

/** The numbers of the providers, as the loader gives them (the components cannot import `server/`). */
export type { AdminProviders };

export async function loader(args: Route.LoaderArgs) {
  await requireRole(args, "admin");
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const days = parseTrafficDays(
    new URL(args.request.url).searchParams.get("days"),
  );
  const providers = await getAdminProviders(await getDb(), new Date(), days);
  // Adds Clerk's state for this page, so Clerk's script can renew the session (ClerkSession).
  return rootAuthLoader(args, () => ({
    title: t("app.pageTitle", { title: t("admin.stats.nav.providers") }),
    publishableKey: keys.publishableKey,
    providers,
    options: [...trafficDays],
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

export default function AdminStatsProviders({
  loaderData,
}: Route.ComponentProps) {
  const { t } = useTranslation();

  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <AdminNav current="stats" />
        <h1 className="text-3xl font-bold">{t("admin.stats.title")}</h1>
        <p className="text-fg-muted mt-2">{t("admin.stats.description")}</p>
        <StatsNav current="providers" />
        <ProvidersPanel
          providers={loaderData.providers}
          options={loaderData.options}
        />
      </main>
    </ClerkSession>
  );
}
