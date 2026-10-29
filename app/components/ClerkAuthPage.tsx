import { ClerkProvider } from "@clerk/react-router";
import { linkClass } from "~/lib/ui";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";

import { english, spanish } from "~/lib/clerk-localization";

type Props = {
  clerkState: unknown;
  publishableKey: string;
  children: ReactNode;
};

/**
 * Loads Clerk's browser code for the sign-in and sign-up pages only. The rest of the site
 * reads the session on the server and ships no Clerk code (and keeps the strict CSP).
 */
export function ClerkAuthPage({ clerkState, publishableKey, children }: Props) {
  const { i18n } = useTranslation();

  return (
    <ClerkProvider
      loaderData={clerkState}
      publishableKey={publishableKey}
      localization={i18n.language === "en" ? english : spanish}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <main className="container mx-auto flex flex-col items-center px-4 py-12">
        {children}
        <p className="text-fg-muted mt-6 max-w-sm text-center text-sm">
          <Trans
            i18nKey="legal.consent"
            components={{
              terms: <Link to="/terms" className={linkClass} />,
              privacy: <Link to="/privacy" className={linkClass} />,
              community: <Link to="/community" className={linkClass} />,
            }}
          />
        </p>
      </main>
    </ClerkProvider>
  );
}
