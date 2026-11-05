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

describe("the link Perfil of the account menu (SAG-114)", () => {
  it("is the first link of the menu, and goes to the profile of the person", async () => {
    const html = await render(<AccountMenu username="ana_reads" />);

    expect(hrefs(html)).toEqual([
      "/u/ana_reads",
      "/settings/profile",
      "/sign-out",
    ]);
    expect(html).toMatch(/<a [^>]*href="\/u\/ana_reads"[^>]*>Perfil<\/a>/);
  });

  it("goes before the administration for an administrator, which stays above sign out", async () => {
    const html = await render(<AccountMenu isAdmin username="ana_reads" />);

    expect(hrefs(html)).toEqual([
      "/u/ana_reads",
      "/settings/profile",
      "/admin/sagas",
      "/sign-out",
    ]);
  });

  it("is not there without a username, instead of a link to nowhere", async () => {
    const html = await render(<AccountMenu />);

    expect(hrefs(html)).toEqual(["/settings/profile", "/sign-out"]);
    expect(html).not.toContain("Perfil");
  });

  it("is a plain anchor, which loads a new document, like the other links of the account", async () => {
    const html = await render(<AccountMenu username="ana_reads" />);
    const link = html.match(/<a [^>]*href="\/u\/ana_reads"[^>]*>/)?.[0] ?? "";

    expect(link).not.toContain("data-discover");
    expect(link).not.toContain("tabindex");
    expect(link).not.toContain("aria-hidden");
  });

  it("keeps an odd username safe in the address", async () => {
    const html = await render(<AccountMenu username="a b/c?d" />);

    expect(html).toContain('href="/u/a%20b%2Fc%3Fd"');
    expect(html).not.toContain('href="/u/a b/c?d"');
  });

  it("says it in English", async () => {
    const html = await render(<AccountMenu username="ana_reads" />, "en");

    expect(html).toMatch(/<a [^>]*href="\/u\/ana_reads"[^>]*>Profile<\/a>/);
  });

  it("is in the panel of the menu of a phone too, after nothing but the divider", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn username="ana_reads" />,
    );
    const panelLinks = hrefs(html);

    expect(panelLinks).toContain("/u/ana_reads");
    // The phone list and the wide menu both have it: one for each place that shows the account.
    expect(panelLinks.filter((href) => href === "/u/ana_reads")).toHaveLength(
      2,
    );
    expect(
      panelLinks.indexOf("/u/ana_reads") <
        panelLinks.indexOf("/settings/profile"),
    ).toBe(true);
  });

  it("is not offered to a visitor, whatever the page was given", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} username="ana_reads" />,
    );

    expect(html).not.toContain("/u/ana_reads");
    expect(html).not.toContain("Perfil");
  });
});

describe("the link to the search of people (SAG-115)", () => {
  it("is in the header of a person with a session", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn username="ana_reads" />,
    );

    expect(hrefs(html)).toContain("/social");
    expect(html).toContain(">Social</a>");
  });

  it("is not offered to a visitor", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn={false} />);

    expect(hrefs(html)).not.toContain("/social");
  });
});
