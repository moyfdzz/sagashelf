import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminMessages from "./admin.messages";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("@clerk/backend", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/auth/admin-write", () => ({}));
vi.mock("~server/db/contact-messages", () => ({}));
vi.mock("~server/contact/messages-panel", () => ({}));
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => <>{children}</>,
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

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const otherId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

const message = (fields: Record<string, unknown> = {}) => ({
  id,
  kind: "problem",
  body: "The search is slow",
  replyEmail: null,
  status: "new",
  username: "ana",
  createdAt: Date.parse("2026-11-06T22:35:00Z"),
  ...fields,
});

const props = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Mensajes",
      publishableKey: "pk_test_x",
      notice: null,
      error: null,
      confirmId: null,
      messages: [message()],
      ...extra,
    },
  }) as unknown as Parameters<typeof AdminMessages>[0];

const intents = (html: string) =>
  [...html.matchAll(/name="intent" value="(\w+)"/g)].map((m) => m[1]);

describe("the page of messages (SAG-110)", () => {
  it("lists a message with its kind, its author, its time in Monterrey and its text", async () => {
    const html = await render(<AdminMessages {...props()} />);

    expect(html).toContain("Mensajes");
    expect(html).toContain("Un problema");
    expect(html).toContain("Nuevo");
    expect(html).toMatch(/<a [^>]*href="\/u\/ana"/);
    expect(html).toContain("The search is slow");
    // 22:35 UTC is 16:35 in Monterrey.
    expect(html).toContain("6 nov 2026, 16:35");
    expect(html).not.toContain("22:35");
  });

  it("says a visitor is a visitor, and shows the address to answer at as text, not as a link", async () => {
    const html = await render(
      <AdminMessages
        {...props({
          messages: [
            message({
              username: null,
              kind: "help",
              replyEmail: "visitor@example.test",
            }),
          ],
        })}
      />,
    );

    expect(html).toContain("Visitante");
    expect(html).toContain("Ayuda");
    expect(html).toContain("Responder a:");
    expect(html).toContain("visitor@example.test");
    expect(html).not.toContain("mailto:");
    expect(html).not.toMatch(/href="\/u\//);
  });

  it("draws the text as plain text, and keeps its line breaks", async () => {
    const html = await render(
      <AdminMessages
        {...props({
          messages: [message({ body: "<b>bold</b>\nsecond line" })],
        })}
      />,
    );

    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold");
    expect(html).toMatch(/whitespace-pre-line[^>]*>[^<]*&lt;b&gt;/);
  });

  it("offers to mark a new message as handled and a handled one as new, and to delete either", async () => {
    const html = await render(
      <AdminMessages
        {...props({
          messages: [
            message(),
            message({ id: otherId, status: "handled", username: "bob" }),
          ],
        })}
      />,
    );

    expect(intents(html)).toEqual(["handled", "reopen"]);
    expect(html).toContain("Marcar como atendido");
    expect(html).toContain("Marcar como nuevo");
    expect(html).toContain("Atendido");
    expect(html).toContain(`href="/admin/messages?confirm=${id}"`);
    expect(html).toContain(`href="/admin/messages?confirm=${otherId}"`);
    expect(html).toContain(`name="id" value="${id}"`);
  });

  it("draws the delete button in red, as a link that opens the modal", async () => {
    const html = await render(<AdminMessages {...props()} />);

    const link = html.match(
      new RegExp(`<a [^>]*href="/admin/messages\\?confirm=${id}"[^>]*>Borrar<`),
    );
    expect(link?.[0]).toContain("bg-danger-bg");
    expect(html).not.toContain("<dialog");
  });

  it("asks before deleting in a modal, on the card that was asked for and no other", async () => {
    const html = await render(
      <AdminMessages
        {...props({
          confirmId: id,
          messages: [message(), message({ id: otherId, username: "bob" })],
        })}
      />,
    );

    expect(html).toContain("¿Borrar este mensaje?");
    expect(html).toContain("Sí, borrar");
    expect(html).toMatch(/<a [^>]*href="\/admin\/messages"[^>]*>Cancelar</);
    // Only the first card has a dialog, and its confirm button deletes that message.
    expect(html.match(/<dialog /g)).toHaveLength(1);
    expect(intents(html)).toEqual(["handled", "delete", "handled"]);
    expect(html).toMatch(
      new RegExp(
        `<dialog[^>]*>[\\s\\S]*name="intent" value="delete"[^>]*>\\s*<input type="hidden" name="id" value="${id}"`,
      ),
    );
  });

  it("says there are none when there are none", async () => {
    const html = await render(<AdminMessages {...props({ messages: [] })} />);

    expect(html).toContain("No hay mensajes.");
    expect(intents(html)).toEqual([]);
  });

  it("says what happened, and why an action did not", async () => {
    for (const [notice, text] of [
      ["handled", "marcado como atendido"],
      ["reopened", "marcado como nuevo"],
      ["deleted", "Mensaje borrado"],
    ]) {
      const html = await render(<AdminMessages {...props({ notice })} />);
      // A toast (SAG-159): the text is in the bold line inside the live region.
      expect(html).toMatch(
        new RegExp(`role="status"[^>]*>[\\s\\S]*?font-semibold">[^<]*${text}`),
      );
    }
    for (const [error, text] of [
      ["invalid_request", "No se pudo leer la acción"],
      ["not_found", "ya no existe"],
    ]) {
      const html = await render(<AdminMessages {...props({ error })} />);
      expect(html).toMatch(new RegExp(`role="alert"[^>]*>[^<]*${text}`));
    }
  });

  it("has the tab of the messages in the administration, marked as the current one", async () => {
    const html = await render(<AdminMessages {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/messages"[^>]*aria-current="page"/,
    );
  });

  it("is written in English too", async () => {
    const html = await render(
      <AdminMessages {...props({ notice: "deleted", confirmId: id })} />,
      "en",
    );

    expect(html).toContain("Messages");
    expect(html).toContain("Message deleted.");
    expect(html).toContain("A problem");
    expect(html).toContain("Delete this message?");
    expect(html).toContain("Yes, delete");
    expect(html).toContain("Nov 6, 2026, 4:35");
  });
});
