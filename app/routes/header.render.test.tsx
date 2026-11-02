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

    expect(without).toEqual(["/settings/profile", "/sign-out"]);
    expect(withAdmin).toEqual([
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

describe("the navigation of the header (SAG-96)", () => {
  const navHrefs = (html: string) =>
    hrefs(html.match(/<nav [\s\S]*?<\/nav>/)?.[0] ?? "");

  it("lists home, search, library, statistics and recommendations for a signed-in person", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);

    expect(navHrefs(html)).toEqual([
      "/",
      "/search",
      "/library",
      "/stats",
      "/recommendations",
    ]);
  });

  it("lists only home and search for a visitor, who has no session links anywhere", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn={false} />);

    expect(navHrefs(html)).toEqual(["/", "/search"]);
    for (const path of ["/library", "/stats", "/recommendations", "/settings"])
      expect(html).not.toContain(`href="${path}`);
  });

  it("keeps the library a plain anchor, and the other pages the router's", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const anchor = (path: string) =>
      html.match(new RegExp(`<a [^>]*href="${path}"[^>]*>`))?.[0] ?? "";

    expect(anchor("/library")).not.toContain("data-discover");
    expect(anchor("/stats")).toContain("data-discover");
    expect(anchor("/recommendations")).toContain("data-discover");
  });

  it("has a menu button for phones that names the panel it opens, closed at first", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const button = html.match(/<button [^>]*aria-expanded[^>]*>/)?.[0] ?? "";
    const id = button.match(/aria-controls="([^"]+)"/)?.[1] ?? "";

    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain("xl:hidden");
    expect(id).not.toBe("");
    expect(html).toMatch(
      new RegExp(`<div [^>]*id="${id}"[^>]*class="[^"]*hidden`),
    );
    expect(html).toContain("Menú");
  });

  it("puts the account links in the panel of a phone and in the menu of a wide screen", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn isAdmin />);
    const count = (path: string) => html.split(`href="${path}"`).length - 1;

    for (const path of ["/settings/profile", "/admin/sagas", "/sign-out"])
      expect(count(path)).toBe(2);
  });

  it("puts sign in and sign up in the panel of a phone too, for a visitor", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn={false} />);

    expect(html.split('href="/sign-in"').length - 1).toBe(2);
    expect(html.split('href="/sign-up"').length - 1).toBe(2);
  });

  it("says the menu button in English", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} />,
      "en",
    );

    expect(html).toContain("Menu");
    expect(html).toContain("Home");
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
