import { ClerkProvider } from "@clerk/react-router";
import { enUS, esMX } from "@clerk/localizations";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
      localization={i18n.language === "en" ? enUS : esMX}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <main className="container mx-auto flex justify-center px-4 py-12">
        {children}
      </main>
    </ClerkProvider>
  );
}
