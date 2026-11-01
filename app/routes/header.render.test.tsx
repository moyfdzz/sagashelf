import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "~/components/AccountMenu";
import { Navbar } from "~/components/Navbar";
import { resources } from "~/locales";

async function render(
  element: ReactNode,
  locale: "es" | "en" = "es",
): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter([{ path: "/", element }], {
    initialEntries: ["/"],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const hrefs = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);

describe("the link to the administration in the account menu (SAG-95)", () => {
  it("is in the menu of an administrator, as a plain link to the curation screen", async () => {
    const html = await render(<AccountMenu isAdmin />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/sagas"[^>]*>Administración<\/a>/,
    );
    // A plain anchor: the administration has a security policy of its own, which only a new
    // document gets, and a link of the router carries `data-discover`.
    const link = html.match(/<a [^>]*href="\/admin\/sagas"[^>]*>/)?.[0];
    expect(link).not.toContain("data-discover");
  });

  it("is not in the menu of anybody else, in the markup or anywhere", async () => {
    for (const html of [
      await render(<AccountMenu />),
      await render(<AccountMenu isAdmin={false} />),
    ]) {
      expect(html).not.toContain("/admin");
      expect(html).not.toContain("Administración");
    }
  });

  it("keeps the other links, in the same order, with the administration above sign out", async () => {
    const without = hrefs(await render(<AccountMenu />));
    const withAdmin = hrefs(await render(<AccountMenu isAdmin />));

    expect(without).toEqual([
      "/library",
      "/stats",
      "/settings/profile",
      "/sign-out",
    ]);
    expect(withAdmin).toEqual([
      "/library",
      "/stats",
      "/settings/profile",
      "/admin/sagas",
      "/sign-out",
    ]);
  });

  it("says it in English", async () => {
    const html = await render(<AccountMenu isAdmin />, "en");

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/sagas"[^>]*>Administration<\/a>/,
    );
  });

  it("is a link a keyboard reaches, named by its own text", async () => {
    const html = await render(<AccountMenu isAdmin />);
    const link = html.match(/<a [^>]*href="\/admin\/sagas"[^>]*>/)?.[0] ?? "";

    expect(link).not.toContain("tabindex");
    expect(link).not.toContain("aria-hidden");
  });
});

describe("the header and the administration (SAG-95)", () => {
  it("shows the account menu with the link to an administrator", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn isAdmin />);

    expect(html).toContain('href="/admin/sagas"');
    expect(html).toContain("Cuenta");
  });

  it("shows the menu without the link to a person who is not one", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);

    expect(html).toContain("Cuenta");
    expect(html).not.toContain("/admin");
  });

  it("shows no account menu, and no link, to a visitor, even if told the flag", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} isAdmin />,
    );

    expect(html).not.toContain("/admin");
    expect(html).toContain('href="/sign-in"');
  });
});
