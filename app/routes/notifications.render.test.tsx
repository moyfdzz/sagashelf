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
      title: "Avisos | SagaShelf",
      publishableKey: "publishable-key-for-tests",
      unread: 0,
      items: [],
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
    expect(html).toContain("Todavía no hay avisos");
    expect(html).toContain("No tienes avisos sin leer.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<ol");
  });

  it("announces the count in a live region that is always in the page", async () => {
    const empty = await render(page());
    const some = await render(page({ unread: 3, items: [unreadItem] }));
    const one = await render(page({ unread: 1, items: [unreadItem] }));

    expect(empty).toMatch(
      /role="status"[^>]*>[\s\S]*No tienes avisos sin leer/,
    );
    expect(some).toMatch(
      /role="status"[^>]*>[\s\S]*Tienes 3 avisos sin leer\./,
    );
    expect(one).toContain("Tienes 1 aviso sin leer.");
  });

  it("lists each one with its title, which episode, a plain link to the entry and the date", async () => {
    const html = await render(page({ unread: 1, items: [unreadItem] }));

    expect(html).toMatch(/<ol [^>]*aria-label="Lista de avisos"/);
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

    expect(html.match(/Nuevo/g)).toHaveLength(1);
    expect(html.match(/name="intent" value="read"/g)).toHaveLength(1);
    expect(html).toContain(`name="id" value="${unreadItem.id}"`);
    expect(readPart).not.toContain("Marcar como leído");
    // A title with no link or no number is still shown, as text.
    expect(readPart).not.toContain("<a ");
  });

  it("offers to mark everything only while something is unread", async () => {
    const withUnread = await render(page({ unread: 2, items: [unreadItem] }));
    const allRead = await render(page({ unread: 0, items: [readItem] }));

    expect(withUnread).toContain("Marcar todos como leídos");
    expect(withUnread).toMatch(/name="intent" value="all"/);
    expect(allRead).not.toContain("Marcar todos como leídos");
  });

  it("says what happened after a mark, and shows an error as an alert", async () => {
    const read = await render(page({}, { ok: true, intent: "read" }));
    const all = await render(page({}, { ok: true, intent: "all" }));
    const error = await render(page({}, { ok: false, error: "not_found" }));

    expect(read).toContain("Aviso marcado como leído.");
    expect(all).toContain("Avisos marcados como leídos.");
    expect(error).toMatch(/role="alert"[^>]*>No encontramos ese aviso\./);
  });

  it("says it all in English", async () => {
    const html = await render(page({ unread: 2, items: [unreadItem] }), "en");
    const empty = await render(page(), "en");

    expect(html).toContain("You have 2 unread alerts.");
    expect(html).toContain("Mark as read");
    expect(html).toContain("Mark all as read");
    expect(html).toContain("New");
    expect(empty).toContain("No alerts yet.");
  });
});
