import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { SettingsNav } from "~/components/SettingsNav";
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

const links = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>([^<]+)<\/a>/g)].map((match) => ({
    label: match[2],
    href: match[1]?.match(/href="([^"]+)"/)?.[1],
    attributes: match[1] ?? "",
  }));

describe("the navigation of the settings (SAG-27)", () => {
  it("jumps to the sections of the profile page and links to the notifications", async () => {
    const found = links(await render(<SettingsNav />));

    expect(found.map(({ label, href }) => [label, href])).toEqual([
      ["Perfil", "#profile"],
      ["Mis datos", "#data"],
      ["Eliminar cuenta", "#delete"],
      ["Notificaciones", "/settings/notifications"],
    ]);
  });

  it("links to the notifications with a plain anchor, which loads a new document (ADR-018)", async () => {
    const found = links(await render(<SettingsNav />));
    const notifications = found.find(
      (link) => link.href === "/settings/notifications",
    );

    expect(notifications).toBeDefined();
    expect(notifications?.attributes).not.toContain("data-discover");
  });

  it("says it in English", async () => {
    const found = links(await render(<SettingsNav />, "en"));

    expect(found.map((link) => link.label)).toEqual([
      "Profile",
      "My data",
      "Delete account",
      "Notifications",
    ]);
  });
});
