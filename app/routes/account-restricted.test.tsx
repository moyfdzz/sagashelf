import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import AccountRestricted, { headers, meta } from "./account-restricted";
import { contactEmail } from "~/lib/legal";
import { resources } from "~/locales";

async function render(locale: "es" | "en" = "es"): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const element: ReactNode = <AccountRestricted />;
  const router = createMemoryRouter([{ path: "/", element }], {
    initialEntries: ["/"],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("the page of a restricted account (SAG-148)", () => {
  it("says what happened, where to write and links the rules", async () => {
    const html = await render();

    expect(html).toContain("Tu cuenta está restringida");
    expect(html).toContain("suspendió o baneó tu cuenta");
    expect(html).toContain(`href="mailto:${contactEmail}"`);
    expect(html).toMatch(/<a [^>]*href="\/community"/);
  });

  it("lets the person sign out, with a plain anchor like every link to a session page", async () => {
    const html = await render();

    const link = html.match(/<a [^>]*href="\/sign-out"[^>]*>/)?.[0] ?? "";
    expect(link).not.toBe("");
    expect(link).not.toContain("data-discover");
    expect(html).toContain("Cerrar sesión");
  });

  it("says nothing of why, of who or of what, so it is the same for every account", async () => {
    const html = await render();

    for (const word of [
      "reporte",
      "reportó",
      "foto",
      "motivo",
      "suspendida",
      "baneada",
    ]) {
      expect(html.toLowerCase()).not.toContain(` ${word}`);
    }
  });

  it("is written in English for an English page", async () => {
    const html = await render("en");

    expect(html).toContain("Your account is restricted");
    expect(html).toContain("Sign out");
  });

  it("is not indexed and never kept by a shared cache", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});
