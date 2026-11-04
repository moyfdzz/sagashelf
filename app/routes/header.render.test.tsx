import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "~/components/AccountMenu";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
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

  it("lists home, search, library, alerts, statistics and recommendations for a signed-in person", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);

    expect(navHrefs(html)).toEqual([
      "/",
      "/search",
      "/library",
      "/notifications",
      "/stats",
      "/recommendations",
    ]);
  });

  it("lists only home and search for a visitor, who has no session links anywhere", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn={false} />);

    expect(navHrefs(html)).toEqual(["/", "/search"]);
    for (const path of [
      "/library",
      "/notifications",
      "/stats",
      "/recommendations",
      "/settings",
    ])
      expect(html).not.toContain(`href="${path}`);
  });

  it("keeps the library and the alerts plain anchors, and the other pages the router's", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const anchor = (path: string) =>
      html.match(new RegExp(`<a [^>]*href="${path}"[^>]*>`))?.[0] ?? "";

    expect(anchor("/library")).not.toContain("data-discover");
    expect(anchor("/notifications")).not.toContain("data-discover");
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

describe("the language switch (SAG-104)", () => {
  const buttons = (html: string) => [
    ...html.matchAll(/<button [^>]*lang="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g),
  ];

  it("shows the code on a phone and the name on a wide screen, in each button", async () => {
    const html = await render(<LanguageSwitcher />);
    const [es, en] = buttons(html);

    expect(es?.[2]).toMatch(/<span[^>]*xl:hidden[^>]*>ES<\/span>/);
    expect(es?.[2]).toMatch(/<span[^>]*hidden xl:inline[^>]*>Español<\/span>/);
    expect(en?.[2]).toMatch(/<span[^>]*xl:hidden[^>]*>EN<\/span>/);
    expect(en?.[2]).toMatch(/<span[^>]*hidden xl:inline[^>]*>English<\/span>/);
  });

  it("names each button with the whole word, whatever is drawn, and keeps its language", async () => {
    const html = await render(<LanguageSwitcher />);
    const [es, en] = buttons(html);

    expect(es?.[0]).toContain('aria-label="Español"');
    expect(es?.[1]).toBe("es");
    expect(en?.[0]).toContain('aria-label="English"');
    expect(en?.[1]).toBe("en");
    // What is drawn is hidden from a screen reader, so it reads the name once and not the code.
    expect(es?.[2]?.match(/aria-hidden="true"/g)).toHaveLength(2);
  });

  it("says which language is on, and stays a form that works without JavaScript", async () => {
    const html = await render(<LanguageSwitcher />, "en");

    expect(html).toMatch(/<form [^>]*action="\/api\/locale"[^>]*method="post"/);
    expect(html).toMatch(/aria-label="English"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Español"[^>]*aria-pressed="false"/);
  });
});

describe("the header on a phone (SAG-104)", () => {
  const tag = (html: string, pattern: RegExp) => html.match(pattern)?.[0] ?? "";
  const classesOf = (element: string) =>
    element.match(/class="([^"]*)"/)?.[1]?.split(" ") ?? [];

  it("puts the language, the theme and the menu in that order, after the name of the app", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const at = (text: string) => html.indexOf(text);

    expect(at("SagaShelf")).toBeGreaterThan(-1);
    expect(at("SagaShelf")).toBeLessThan(at('action="/api/locale"'));
    expect(at('action="/api/locale"')).toBeLessThan(at('role="switch"'));
    expect(at('role="switch"')).toBeLessThan(at("aria-expanded"));
  });

  it("never gives the logo an order of its own on a phone, or the switches would be drawn before it", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const logo = classesOf(tag(html, /<a [^>]*href="\/"[^>]*>/));

    expect(logo.filter((name) => /^order-/.test(name))).toEqual([]);
    expect(logo).toContain("xl:order-1");
    // The name of the app keeps its size, and never shrinks or breaks, at any width.
    expect(logo).toContain("shrink-0");
    expect(logo).toContain("whitespace-nowrap");
    expect(logo).toContain("text-2xl");
  });

  it("opens the panel under the button: both are in one box, and the panel hangs from its bottom, right-aligned", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const button = tag(html, /<button [^>]*aria-expanded[^>]*>/);
    const id = button.match(/aria-controls="([^"]+)"/)?.[1] ?? "";
    const box = html.match(
      /<div class="relative[^"]*">(<button [^>]*aria-expanded[\s\S]*?<div [^>]*id="([^"]+)")/,
    );
    const panel = classesOf(
      tag(html, new RegExp(`<div [^>]*id="${id}"[^>]*>`)),
    );

    expect(id).not.toBe("");
    expect(box?.[2]).toBe(id);
    for (const name of ["absolute", "top-full", "right-0", "z-50", "shadow-lg"])
      expect(panel).toContain(name);
    expect(panel).toContain("border");
    expect(panel).toContain("rounded-md");
    // It never gets wider than the screen allows, so it is not cut by the edge.
    expect(panel).toContain("w-[min(20rem,calc(100vw-2rem))]");
  });

  it("draws the panel as if it were not there on a wide screen, and keeps the order of the row", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const box = classesOf(tag(html, /<div class="relative[^"]*">/));
    const panel = classesOf(
      tag(
        html,
        new RegExp(
          `<div [^>]*id="${html.match(/aria-controls="([^"]+)"/)?.[1]}"[^>]*>`,
        ),
      ),
    );
    const nav = classesOf(tag(html, /<nav [^>]*>/));
    const switches = classesOf(
      tag(html, /<div class="[^"]*">(?=<form [^>]*\/api\/locale)/),
    );
    const account = classesOf(
      tag(html, /<div class="hidden[^"]*xl:block[^"]*">/),
    );

    expect(box).toContain("xl:contents");
    expect(panel).toContain("xl:contents");
    expect(nav).toContain("xl:order-2");
    expect(switches).toContain("xl:order-3");
    expect(account).toContain("xl:order-4");
  });

  it("keeps the row whole from 360 px, and puts the switches on a second row below it", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const switches = classesOf(
      tag(html, /<div class="[^"]*">(?=<form [^>]*\/api\/locale)/),
    );
    const box = classesOf(tag(html, /<div class="relative[^"]*">/));

    expect(switches).toContain("max-[360px]:basis-full");
    expect(switches).toContain("max-[360px]:order-3");
    expect(box).toContain("max-[360px]:order-2");
  });

  it("draws the word of the menu button from 420 px, and only the icon below it, keeping the word as its name", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const button = tag(html, /<button [^>]*aria-expanded[^>]*>/);
    const label = html.match(/<span class="([^"]*)">Menú<\/span>/);

    expect(label?.[1]).toContain("max-[420px]:sr-only");
    expect(classesOf(button)).toContain("min-[420px]:px-3");
    // The padding is the small one below 420 px, so the icon alone is not wide.
    expect(classesOf(button)).toContain("px-2");
  });

  it("says the same in English", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} />,
      "en",
    );

    expect(html).toMatch(
      /<span class="[^"]*max-\[420px\]:sr-only">Menu<\/span>/,
    );
    expect(html).toContain('aria-label="English"');
  });
});

describe("the unread alerts in the header (SAG-102)", () => {
  const link = (html: string) =>
    html.match(/<a [^>]*href="\/notifications"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
  const menuButton = (html: string) =>
    html.match(/<button [^>]*aria-expanded[\s\S]*?<\/button>/)?.[0] ?? "";

  it("shows nothing next to the link, and no dot, when there is nothing unread", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn unread={0} />);

    expect(link(html)).not.toContain("rounded-full");
    expect(link(html)).not.toContain("sin leer");
    expect(menuButton(html)).not.toContain("rounded-full");
  });

  it("shows the count on the link, hidden from a screen reader that reads it in words instead", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn unread={3} />);

    expect(link(html)).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
    expect(link(html)).toMatch(/<span class="sr-only">, 3 sin leer<\/span>/);
  });

  it("says 99+ when there are more than 99, in the words too", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn unread={100} />,
    );

    expect(link(html)).toMatch(/aria-hidden="true"[^>]*>99\+<\/span>/);
    expect(link(html)).toContain(", 99+ sin leer");
  });

  it("puts a dot on the menu button, since the link is inside its panel, and names it for a screen reader", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn unread={2} />);
    const button = menuButton(html);

    expect(button).toMatch(/<span aria-hidden="true" class="[^"]*xl:hidden/);
    expect(button).toContain(", 2 sin leer");
  });

  it("says it in English", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn unread={2} />,
      "en",
    );

    expect(link(html)).toContain("Alerts");
    expect(link(html)).toContain(", 2 unread");
  });

  it("does not show a visitor any of it", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} unread={5} />,
    );

    expect(html).not.toContain("/notifications");
    expect(html).not.toContain("sin leer");
  });
});
