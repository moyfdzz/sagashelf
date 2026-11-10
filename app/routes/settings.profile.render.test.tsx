import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import ProfileSettings from "./settings.profile";
import { wrappingSecondaryLinkClass } from "~/lib/ui";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/profile", () => ({}));
vi.mock("~server/db/username", () => ({}));
vi.mock("~server/rate-limit", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => children,
}));

async function render(locale: "es" | "en"): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const props = {
    loaderData: {
      profile: {
        username: "ana",
        displayName: null,
        avatarUrl: null,
        hasOwnPicture: false,
        bio: null,
        locale,
        privacy: "public",
      },
      nextUsernameChange: null,
      canUploadPicture: false,
      title: "Perfil",
      publishableKey: "publishable-key-for-tests",
    },
  } as unknown as Parameters<typeof ProfileSettings>[0];
  const router = createMemoryRouter(
    [{ path: "/", element: <ProfileSettings {...props} /> }],
    { initialEntries: ["/"] },
  );
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("the import link of the profile settings (SAG-228)", () => {
  it.each([
    ["es", "Importar mi biblioteca desde un archivo"],
    ["en", "Import my library from a file"],
  ] as const)(
    "draws the link with the class that lets its text wrap, in %s",
    async (locale, label) => {
      const html = await render(locale);
      // Only the opening tag, found by its address: an icon or a span inside would not matter.
      const tag = /<a\b[^>]*\bhref="\/settings\/import"[^>]*>/.exec(html)?.[0];

      expect(tag).toBeDefined();
      expect(tag).toContain(wrappingSecondaryLinkClass);
      expect(html).toContain(label);
    },
  );
});
