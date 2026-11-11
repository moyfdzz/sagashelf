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
      "/lists",
      "/settings/profile",
      "/sign-out",
    ]);
    expect(html).toMatch(/<a [^>]*href="\/u\/ana_reads"[^>]*>Perfil<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/lists"[^>]*>Mis listas<\/a>/);
  });

  it("goes before the administration for an administrator, which stays above sign out", async () => {
    const html = await render(<AccountMenu isAdmin username="ana_reads" />);

    expect(hrefs(html)).toEqual([
      "/u/ana_reads",
      "/lists",
      "/settings/profile",
      "/admin/sagas",
      "/sign-out",
    ]);
  });

  it("is not there without a username, instead of a link to nowhere", async () => {
    const html = await render(<AccountMenu />);

    expect(hrefs(html)).toEqual(["/lists", "/settings/profile", "/sign-out"]);
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

describe("the picture of the person (SAG-109)", () => {
  const picture = "https://img.clerk.com/ana";

  it("replaces the word on the button of the menu, and the word stays as its name", async () => {
    const html = await render(<AccountMenu avatarUrl={picture} />);
    const button = /<button.*?<\/button>/s.exec(html)?.[0] ?? "";

    expect(button).toContain(`src="${picture}"`);
    expect(button).toContain('<span class="sr-only">Cuenta</span>');
    // A screen reader says the name of the button once, and skips the picture.
    expect(button).toMatch(/<span aria-hidden="true"[^>]*><img /);
  });

  it("leaves the word when there is no picture", async () => {
    const html = await render(<AccountMenu />);
    const button = /<button.*?<\/button>/s.exec(html)?.[0] ?? "";

    expect(button).not.toContain("<img");
    expect(button).not.toContain("sr-only");
    expect(button).toContain("Cuenta");
  });

  it("is next to the link to the profile in the panel of a phone, and in the menu of a wide screen", async () => {
    const html = await render(
      <Navbar
        savedTheme={null}
        signedIn
        username="ana_reads"
        avatarUrl={picture}
      />,
    );

    expect(html.split(`src="${picture}"`)).toHaveLength(3);
  });

  it("is not drawn for a visitor, whatever the page was given", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} avatarUrl={picture} />,
    );

    expect(html).not.toContain(picture);
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

describe("the initial of the person when there is no picture (SAG-39)", () => {
  const button = (html: string) =>
    /<button.*?<\/button>/s.exec(html)?.[0] ?? "";

  it("takes the place of the word on the button, and the word stays as its name", async () => {
    const html = button(await render(<AccountMenu username="ana_reads" />));

    expect(html).not.toContain("<img");
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><span[^>]*>A<\/span>/);
    expect(html).toContain('<span class="sr-only">Cuenta</span>');
  });

  it("says its name in English", async () => {
    const html = button(
      await render(<AccountMenu username="ana_reads" />, "en"),
    );

    expect(html).toContain('<span class="sr-only">Account</span>');
  });

  it("is a circle of the same size as the picture, so the button does not change height", async () => {
    const withInitial = button(await render(<AccountMenu username="ana" />));
    const withPicture = button(
      await render(<AccountMenu username="ana" avatarUrl="https://x/p.png" />),
    );

    expect(withInitial).toContain("size-7");
    expect(withInitial).toContain("h-[42px]");
    expect(withPicture).toContain("h-[42px]");
  });

  it("uses the accent colors of the app", async () => {
    const html = button(await render(<AccountMenu username="ana" />));

    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent-fg");
  });

  it("leaves the picture when there is one, and the word when there is no username", async () => {
    const picture = button(
      await render(<AccountMenu username="ana" avatarUrl="https://x/p.png" />),
    );
    const none = button(await render(<AccountMenu />));

    expect(picture).toContain("<img");
    expect(picture).not.toContain("data-avatar-initial");
    expect(none).not.toContain("data-avatar-initial");
    expect(none).toContain("Cuenta");
  });

  it("is next to the link to the profile in the panel of a phone", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn username="ana_reads" />,
    );

    // One in the panel of the phone, one on the button of a wide screen.
    expect(html.split("data-avatar-initial")).toHaveLength(3);
  });
});
