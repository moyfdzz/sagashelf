import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Notifications from "./notifications";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/notifications", () => ({}));
vi.mock("~server/db/follow-requests", () => ({}));
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

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";
const unreadItem = {
  id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
  title: "Severance",
  which: "temporada 2, episodio 5",
  href: `/library/${mediaId}`,
  createdAt: "2026-11-03T12:00:00.000Z",
  read: false,
};
const readItem = {
  id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e71",
  title: "Andor",
  which: null,
  href: null,
  createdAt: "2026-11-02T12:00:00.000Z",
  read: true,
};

const props = (loader: Record<string, unknown> = {}, actionData?: unknown) =>
  ({
    loaderData: {
      title: "Notificaciones | SagaShelf",
      publishableKey: "publishable-key-for-tests",
      unread: 0,
      items: [],
      requests: [],
      ...loader,
    },
    actionData,
  }) as unknown as Parameters<typeof Notifications>[0];

const page = (loader?: Record<string, unknown>, actionData?: unknown) => (
  <Notifications {...props(loader, actionData)} />
);

describe("the inbox of notifications page (SAG-102)", () => {
  it("has an empty state that says when something will show up, and no buttons", async () => {
    const html = await render(page());

    expect(html).toContain("<h1");
    expect(html).toContain("Todavía no hay notificaciones");
    expect(html).toContain("No tienes notificaciones sin leer.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<ol");
  });

  it("announces the count in a live region that is always in the page", async () => {
    const empty = await render(page());
    const some = await render(page({ unread: 3, items: [unreadItem] }));
    const one = await render(page({ unread: 1, items: [unreadItem] }));

    expect(empty).toMatch(
      /role="status"[^>]*>[\s\S]*No tienes notificaciones sin leer/,
    );
    expect(some).toMatch(
      /role="status"[^>]*>[\s\S]*Tienes 3 notificaciones sin leer\./,
    );
    expect(one).toContain("Tienes 1 notificación sin leer.");
  });

  it("lists each one with its title, which episode, a plain link to the entry and the date", async () => {
    const html = await render(page({ unread: 1, items: [unreadItem] }));

    expect(html).toMatch(/<ol [^>]*aria-label="Lista de notificaciones"/);
    expect(html).toContain("Severance");
    expect(html).toContain(": temporada 2, episodio 5");
    const link = html.match(/<a [^>]*href="\/library\/[^"]+"[^>]*>/)?.[0] ?? "";
    // A session page is reached by a plain anchor (ADR-018): the router must not take it over.
    expect(link).not.toContain("data-discover");
    expect(html).toContain("2026");
  });

  it("marks an unread one with a word and gives it a button, and a read one neither", async () => {
    const html = await render(
      page({ unread: 1, items: [unreadItem, readItem] }),
    );
    const readPart = html.slice(html.indexOf("Andor"));

    expect(html.match(/Nueva/g)).toHaveLength(1);
    expect(html.match(/name="intent" value="read"/g)).toHaveLength(1);
    expect(html).toContain(`name="id" value="${unreadItem.id}"`);
    expect(readPart).not.toContain("Marcar como leída");
    // A title with no link or no number is still shown, as text.
    expect(readPart).not.toContain("<a ");
  });

  it("offers to mark everything only while something is unread", async () => {
    const withUnread = await render(page({ unread: 2, items: [unreadItem] }));
    const allRead = await render(page({ unread: 0, items: [readItem] }));

    expect(withUnread).toContain("Marcar todas como leídas");
    expect(withUnread).toMatch(/name="intent" value="all"/);
    expect(allRead).not.toContain("Marcar todas como leídas");
  });

  it("says what happened after a mark, and shows an error as an alert", async () => {
    const read = await render(page({}, { ok: true, intent: "read" }));
    const all = await render(page({}, { ok: true, intent: "all" }));
    const error = await render(page({}, { ok: false, error: "not_found" }));

    expect(read).toContain("Notificación marcada como leída.");
    expect(all).toContain("Notificaciones marcadas como leídas.");
    expect(error).toMatch(
      /role="alert"[^>]*>No encontramos esa notificación\./,
    );
  });

  it("says it all in English", async () => {
    const html = await render(page({ unread: 2, items: [unreadItem] }), "en");
    const empty = await render(page(), "en");

    expect(html).toContain("You have 2 unread notifications.");
    expect(html).toContain("Mark as read");
    expect(html).toContain("Mark all as read");
    expect(html).toContain("New");
    expect(empty).toContain("No notifications yet.");
  });
});

describe("the follow requests on the page of notifications (SAG-108)", () => {
  const ana = {
    username: "ana_public",
    name: "Ana",
    canFollowBack: true,
    createdAt: "2026-11-04T10:00:00.000Z",
  };
  const cat = {
    username: "cat_hidden",
    name: "cat_hidden",
    canFollowBack: false,
    createdAt: "2026-11-04T09:00:00.000Z",
  };
  const intents = (html: string) =>
    [...html.matchAll(/name="intent" value="([^"]+)"/g)].map((m) => m[1]);

  it("has no section, and no buttons, when nobody asked", async () => {
    const html = await render(page());

    expect(html).not.toContain("<section");
    expect(html).not.toContain('value="accept"');
  });

  it("lists each request with a plain link to the profile and the three answers", async () => {
    const html = await render(page({ requests: [ana] }));
    const link = html.match(/<a [^>]*href="\/u\/ana_public"[^>]*>/)?.[0] ?? "";

    expect(html).toContain("1 solicitud para seguirte");
    expect(link).not.toContain("data-discover");
    expect(html).toContain("@ana_public");
    expect(intents(html)).toEqual(["accept", "accept_back", "decline"]);
    expect(html).toContain("Aceptar y seguir también");
    expect(html).toContain('name="username" value="ana_public"');
  });

  it("gives each request a View profile button that is a plain link to that profile", async () => {
    const html = await render(page({ requests: [ana, cat] }));
    const buttons = [...html.matchAll(/<a ([^>]*)>Ver perfil<\/a>/g)].map(
      (m) => m[1],
    );

    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('href="/u/ana_public"');
    expect(buttons[1]).toContain('href="/u/cat_hidden"');
    expect(buttons.join(" ")).not.toContain("data-discover");
    expect(await render(page({ requests: [ana] }), "en")).toContain(
      ">View profile</a>",
    );
  });

  it("does not offer to follow back somebody who cannot be followed", async () => {
    const html = await render(page({ requests: [cat] }));

    expect(intents(html)).toEqual(["accept", "decline"]);
    expect(html).not.toContain("Aceptar y seguir también</button>");
  });

  it("counts them in the plural", async () => {
    const html = await render(page({ requests: [ana, cat] }));

    expect(html).toContain("2 solicitudes para seguirte");
  });

  it("draws no picture, since this page has a narrow policy", async () => {
    const html = await render(page({ requests: [ana] }));

    expect(html).not.toContain("<img");
  });

  it("says what happened after each answer, and an error as an alert", async () => {
    const accepted = await render(page({}, { ok: true, intent: "accept" }));
    const back = await render(page({}, { ok: true, intent: "accept_back" }));
    const declined = await render(page({}, { ok: true, intent: "decline" }));
    const error = await render(
      page({}, { ok: false, error: "request_not_found" }),
    );

    expect(accepted).toContain("Aceptaste la solicitud.");
    expect(back).toContain("pediste seguir de vuelta");
    expect(declined).toContain("Rechazaste la solicitud.");
    expect(error).toMatch(/role="alert"[^>]*>No encontramos esa solicitud\./);
  });

  it("says it in English", async () => {
    const html = await render(page({ requests: [ana, cat] }), "en");

    expect(html).toContain("2 requests to follow you");
    expect(html).toContain("Accept and follow back");
    expect(html).toContain("Decline");
  });
});
