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
      /<a [^>]*href="\/admin\/sagas"[^>]*>.*Administración<\/span><\/a>/,
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
      "/lists",
      "/stats",
      "/settings/profile",
      "/sign-out",
    ]);
    expect(withAdmin).toEqual([
      "/lists",
      "/stats",
      "/settings/profile",
      "/admin/sagas",
      "/sign-out",
    ]);
  });

  it("says it in English", async () => {
    const html = await render(<AccountMenu isAdmin />, "en");

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/sagas"[^>]*>.*Administration<\/span><\/a>/,
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

  it("lists home, search, sagas, trending, library, social, alerts and recommendations for a signed-in person", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);

    expect(navHrefs(html)).toEqual([
      "/",
      "/search",
      "/sagas",
      "/trending",
      "/library",
      "/social",
      "/notifications",
      "/recommendations",
    ]);
  });

  it("lists only home, search, sagas and trending for a visitor, who has no session links anywhere", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn={false} />);

    expect(navHrefs(html)).toEqual(["/", "/search", "/sagas", "/trending"]);
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
    expect(anchor("/trending")).toContain("data-discover");
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

    for (const path of [
      "/stats",
      "/settings/profile",
      "/admin/sagas",
      "/sign-out",
    ])
      expect(count(path)).toBe(2);
  });

  it("has the statistics in the account links and not in the row of the header (SAG-261)", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);

    expect(navHrefs(html)).not.toContain("/stats");
    expect(html.match(/<a [^>]*href="\/stats"[^>]*>/g)).toHaveLength(2);
    for (const anchor of html.match(/<a [^>]*href="\/stats"[^>]*>/g) ?? [])
      expect(anchor).not.toContain("data-discover");
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
    // The name of the app never shrinks or breaks, at any width. It is one step smaller below 640 px
    // so it still fits a 320 px phone with the text at 200% (SAG-257).
    expect(logo).toContain("shrink-0");
    expect(logo).toContain("whitespace-nowrap");
    expect(logo).toContain("text-xl");
    expect(logo).toContain("sm:text-2xl");
  });

  it("gives the switches of the header a height of 40 px (SAG-252)", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const theme = classesOf(tag(html, /<button [^>]*role="switch"[^>]*>/));
    const language = classesOf(tag(html, /<button [^>]*value="es"[^>]*>/));

    expect(theme).toContain("size-10");
    expect(language).toContain("min-h-10");
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

  it("shows nothing next to the link, and no count on the menu button, when there is nothing unread", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn unread={0} />);

    expect(link(html)).not.toContain("rounded-full");
    expect(link(html)).not.toContain("pendientes");
    expect(menuButton(html)).not.toContain("rounded-full");
  });

  it("shows the count on the link, hidden from a screen reader that reads it in words instead", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn unread={3} />);

    expect(link(html)).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
    expect(link(html)).toMatch(/<span class="sr-only">, 3 pendientes<\/span>/);
  });

  it("says 99+ when there are more than 99, in the words too", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn unread={100} />,
    );

    expect(link(html)).toMatch(/aria-hidden="true"[^>]*>99\+<\/span>/);
    expect(link(html)).toContain(", 99+ pendientes");
  });

  it("puts the count on the menu button, since the link is inside its panel, and names it for a screen reader (SAG-106)", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn unread={2} />);
    const button = menuButton(html);

    // A bubble with the number, over the corner (absolute, so it adds no width) and only on a phone.
    expect(button).toMatch(
      /<span aria-hidden="true" class="[^"]*absolute[^"]*xl:hidden[^"]*">2<\/span>/,
    );
    expect(button).toContain(", 2 pendientes");
  });

  it('keeps the links of the wide row narrow enough for "Notificaciones" and its count to fit at 1280 px', async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn unread={150} />,
    );

    expect(link(html)).toContain("xl:px-2");
  });

  it("says 99+ on the menu button when there are more than 99", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn unread={150} />,
    );

    expect(menuButton(html)).toMatch(/aria-hidden="true"[^>]*>99\+<\/span>/);
  });

  it("says it in English", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn unread={2} />,
      "en",
    );

    expect(link(html)).toContain("Notifications");
    expect(link(html)).toContain(", 2 pending");
  });

  it("does not show a visitor any of it", async () => {
    const html = await render(
      <Navbar savedTheme={null} signedIn={false} unread={5} />,
    );

    expect(html).not.toContain("/notifications");
    expect(html).not.toContain("pendientes");
  });
});

describe("the icons of the header (SAG-157)", () => {
  const icons = (html: string) =>
    [...html.matchAll(/<svg [^>]*>/g)].map((match) => match[0]);

  it("puts one icon in front of every link of the account, hidden from a screen reader", async () => {
    const html = await render(<AccountMenu isAdmin username="ana_reads" />);
    const links = html.match(/<a [^>]*href=/g) ?? [];
    // The icons of the links plus the arrow of the button.
    const linkIcons = icons(html).filter((svg) => svg.includes("lucide"));

    expect(links).toHaveLength(6);
    expect(linkIcons).toHaveLength(links.length);
    // Each icon sits in a box hidden from a screen reader (the button's own picture is the +1).
    expect(html.match(/<span aria-hidden="true"/g)).toHaveLength(
      links.length + 1,
    );
  });

  it("draws an icon of the row only in the panel of a phone and from 1536 px, never from 1280 to 1535 px", async () => {
    const html = await render(<Navbar savedTheme={null} signedIn />);
    const rowIcons = icons(html).filter((svg) => svg.includes("lucide"));

    // Eight links in the row; the others are the ones of the account in the panel.
    const forRow = rowIcons.filter((svg) => svg.includes("2xl:block"));
    expect(forRow).toHaveLength(8);
    for (const svg of forRow) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain("xl:hidden");
    }
  });
});
