import { ClerkProvider } from "@clerk/react-router";
import type { ReactNode } from "react";

type Props = {
  clerkState: unknown;
  publishableKey: string;
  children: ReactNode;
};

/**
 * Loads Clerk's script on a page of a signed-in person, and draws nothing of its own. Clerk's
 * session token lasts 60 seconds and only this script renews it, so without it a form that stays
 * open for a minute would be sent with an expired session and the person would be sent to sign
 * in. The page keeps working if the script cannot load: it only loses the renewal.
 */
export function ClerkSession({ clerkState, publishableKey, children }: Props) {
  return (
    <ClerkProvider
      loaderData={clerkState}
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      {children}
    </ClerkProvider>
  );
}
