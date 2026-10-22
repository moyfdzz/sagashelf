import { SignUp } from "@clerk/react-router";
import { rootAuthLoader } from "@clerk/react-router/server";
import { data } from "react-router";

import type { Route } from "./+types/sign-up";
import { ClerkAuthPage } from "~/components/ClerkAuthPage";
import { safeRedirectPath } from "~/lib/redirect";
import { getInstance } from "~/middleware/i18next";
import { getClerkKeys } from "~server/runtime-env";

export async function loader(args: Route.LoaderArgs) {
  const keys = getClerkKeys();
  if (!keys) throw data({ error: "auth_not_configured" }, { status: 503 });

  const { t } = getInstance(args.context);
  const redirectTo = safeRedirectPath(
    new URL(args.request.url).searchParams.get("redirectTo"),
  );
  return rootAuthLoader(args, () => ({
    title: t("auth.signUp.title"),
    publishableKey: keys.publishableKey,
    redirectTo,
  }));
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.title }, { name: "robots", content: "noindex" }];
}

export default function SignUpPage({ loaderData }: Route.ComponentProps) {
  return (
    <ClerkAuthPage
      clerkState={loaderData}
      publishableKey={loaderData.publishableKey}
    >
      <SignUp
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl={loaderData.redirectTo}
      />
    </ClerkAuthPage>
  );
}
