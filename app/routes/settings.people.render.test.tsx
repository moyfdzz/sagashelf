import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Privacy from "./privacy";
import People from "./settings.people";
import Terms from "./terms";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the pages are drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/blocks-mutes", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => children,
}));

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

const ben = {
  username: "ben_one",
  displayName: "Ben",
  avatarUrl: "https://img.clerk.com/b",
};
const cat = { username: "cat_one", displayName: null, avatarUrl: null };

const props = (loader: Record<string, unknown> = {}, actionData?: unknown) =>
  ({
    loaderData: {
      title: "Personas bloqueadas y silenciadas | SagaShelf",
      publishableKey: "publishable-key-for-tests",
      blocked: [],
      muted: [],
      ...loader,
    },
    actionData,
  }) as unknown as Parameters<typeof People>[0];

const page = (loader?: Record<string, unknown>, actionData?: unknown) => (
  <People {...props(loader, actionData)} />
);

describe("the page of blocked and muted people (SAG-107)", () => {
  it("has a heading, a plain link back to the settings, and an empty state for each list", async () => {
    const html = await render(page());
    const back =
      html.match(/<a [^>]*href="\/settings\/profile"[^>]*>/)?.[0] ?? "";

    expect(html).toMatch(/<h1[^>]*>Personas bloqueadas y silenciadas<\/h1>/);
    expect(back).not.toContain("data-discover");
    expect(html).toContain("No has bloqueado a nadie.");
    expect(html).toContain("No has silenciado a nadie.");
    expect(html).not.toContain("<form");
  });

  it("lists each blocked person with a button to unblock, and each muted one with a button to unmute", async () => {
    const html = await render(page({ blocked: [ben], muted: [cat] }));

    expect(html).toContain("Ben");
    expect(html).toContain("@ben_one");
    expect(html).toContain("Desbloquear");
    expect(html).toContain('name="intent" value="unblock"');
    expect(html).toContain('name="username" value="ben_one"');
    expect(html).toContain("@cat_one");
    expect(html).toContain("Dejar de silenciar");
    expect(html).toContain('name="intent" value="unmute"');
    expect(html).toContain('name="username" value="cat_one"');
  });

  it("uses an initial when there is no picture, and hides the picture from a screen reader that reads the name", async () => {
    const html = await render(page({ blocked: [ben], muted: [cat] }));

    expect(html).toMatch(/aria-hidden="true"[^>]*>C<\/div>/);
    expect(html).toContain('src="https://img.clerk.com/b"');
  });

  it("says what happened after each undo, in a live region that is always in the page", async () => {
    const empty = await render(page());
    const unblocked = await render(page({}, { ok: true, intent: "unblock" }));
    const unmuted = await render(page({}, { ok: true, intent: "unmute" }));

    expect(empty).toContain('role="status"');
    expect(unblocked).toContain("Desbloqueaste a esa persona.");
    expect(unblocked).toContain("no se restauran");
    expect(unmuted).toContain("Dejaste de silenciar a esa persona.");
  });

  it("shows an error as an alert", async () => {
    const html = await render(
      page({}, { ok: false, error: "invalid_request" }),
    );

    expect(html).toMatch(/role="alert"[^>]*>No pudimos leer el formulario/);
  });

  it("says it in English", async () => {
    const html = await render(page({ blocked: [ben], muted: [cat] }), "en");

    expect(html).toContain("Blocked and muted people");
    expect(html).toContain("Unblock");
    expect(html).toContain("Unmute");
    expect(html).toContain("Muting someone does not tell them.");
  });
});

describe("the legal pages after the profiles (SAG-107)", () => {
  it("tell who sees what of a profile, level by level, in the privacy policy", async () => {
    const html = await render(<Privacy />);

    expect(html).toContain("Quién ve tu perfil");
    expect(html).toContain("Público:");
    expect(html).toContain("Privado:");
    expect(html).toContain("Privacidad total: nadie más que tú ve tu perfil");
    expect(html).toContain("puede enviarte una solicitud para seguirte");
    expect(html).toContain("sigue como enviada hasta que la cancele");
    expect(html).not.toContain("rechazada hasta 30 días");
    expect(html).toContain("tu nombre de usuario, tu nombre y tu foto");
    expect(html).toContain("Tus notas no las ve nadie.");
    expect(html).toContain("Relaciones: a quién sigues");
    expect(html).toContain(
      "tus seguimientos, solicitudes de seguimiento, bloqueos y silencios",
    );
  });

  it("tell it in English too", async () => {
    const html = await render(<Privacy />, "en");

    expect(html).toContain("Who sees your profile");
    expect(html).toContain("Private:");
    expect(html).toContain("Total privacy: nobody but you sees your profile");
    expect(html).toContain("not even that it exists");
    expect(html).toContain("it still looks sent until they cancel it");
    expect(html).not.toContain("declined for up to 30 days");
    expect(html).toContain("your follows, follow requests, blocks and mutes");
  });

  it("say what blocking does and add the use that is not allowed, in the terms", async () => {
    const html = await render(<Terms />);

    expect(html).toContain("Otras personas");
    expect(html).toContain("Bloquear oculta tu perfil para esa persona");
    expect(html).toContain(
      "solicitudes de seguimiento de forma masiva o insistente",
    );
    expect(html).toContain("tu nivel de privacidad");
  });

  it("say it in English too", async () => {
    const html = await render(<Terms />, "en");

    expect(html).toContain("Other people");
    expect(html).toContain("Blocking hides your profile from that person");
    expect(html).toContain(
      "send follow requests to, other people in bulk or insistently",
    );
  });

  it("show the new date, in both languages", async () => {
    expect(await render(<Privacy />)).toContain("4 de noviembre de 2026");
    expect(await render(<Terms />, "en")).toContain("November 4, 2026");
  });
});
