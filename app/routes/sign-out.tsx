import { useClerk } from "@clerk/react-router";
import { rootAuthLoader } from "@clerk/react-router/server";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { data } from "react-router";

import type { Route } from "./+types/sign-out";
import { ClerkSession } from "~/components/ClerkSession";
import { getInstance } from "~/middleware/i18next";
import { getClerkKeys } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  return rootAuthLoader(args, () => ({
    title: t("auth.signOut.title"),
    publishableKey: keys.publishableKey,
  }));
}

// Pages and answers that carry a person's session are never kept by a shared cache.
export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.title }, { name: "robots", content: "noindex" }];
}

// Clerk ends the session from its script, so this page loads it (as the settings pages do), asks
// it to sign out and sends the person home. Someone already signed out just goes home.
function SignOut() {
  const { t } = useTranslation();
  const { signOut } = useClerk();

  useEffect(() => {
    void signOut({ redirectUrl: "/" });
  }, [signOut]);

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t("auth.signOut.title")}</h1>
      <p role="status" className="text-fg-muted mt-2">
        {t("auth.signOut.working")}
      </p>
      <noscript>
        <p className="mt-4">{t("auth.signOut.noScript")}</p>
      </noscript>
    </main>
  );
}

export default function SignOutPage({ loaderData }: Route.ComponentProps) {
  return (
    <ClerkSession
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <SignOut />
    </ClerkSession>
  );
}
