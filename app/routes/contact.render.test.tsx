import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Contact from "./contact";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/contact-messages", () => ({}));
vi.mock("~server/runtime-env", () => ({}));

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

const props = (
  loader: Record<string, unknown> = {},
  actionData: unknown = undefined,
) =>
  ({
    loaderData: {
      title: "Contacto",
      description: "d",
      signedIn: false,
      sent: false,
      ...loader,
    },
    actionData,
  }) as unknown as Parameters<typeof Contact>[0];

const inputTag = (html: string, name: string) =>
  html.match(new RegExp(`<(?:input|textarea)[^>]*name="${name}"[^>]*>`))?.[0] ??
  "";

describe("the contact page (SAG-110)", () => {
  it("offers the three kinds, with the first chosen, and a text of at most 2000 characters", async () => {
    const html = await render(<Contact {...props()} />);

    expect(html).toContain("Contacto");
    for (const text of ["Comentario", "Un problema", "Ayuda"]) {
      expect(html).toContain(text);
    }
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => /value="(\w+)"/.exec(r)?.[1])).toEqual([
      "feedback",
      "problem",
      "help",
    ]);
    expect(radios.filter((r) => r.includes('checked=""'))).toHaveLength(1);
    expect(radios[0]).toContain('checked=""');
    const body = inputTag(html, "body");
    expect(body).toContain('maxLength="2000"');
    expect(body).toContain("required");
    expect(html).toContain("Hasta 2000 caracteres");
  });

  it("asks a visitor for an address, optional and of the right type, and says what it is for", async () => {
    const html = await render(<Contact {...props()} />);

    const email = inputTag(html, "replyEmail");
    expect(email).toContain('type="email"');
    expect(email).toContain('maxLength="254"');
    expect(email).not.toContain("required");
    expect(html).toContain("Tu correo (opcional)");
    expect(html).toContain("Solo lo usamos para responderte");
  });

  it("asks a signed-in person for no address, and says why", async () => {
    const html = await render(<Contact {...props({ signedIn: true })} />);

    expect(inputTag(html, "replyEmail")).toBe("");
    expect(html).toContain("no necesitas dejar un correo");
  });

  it("has the trap field, out of sight and out of the way of a person", async () => {
    const html = await render(<Contact {...props()} />);

    const wrapper =
      html.match(
        /<div class="hidden" aria-hidden="true">[\s\S]*?<\/div>/,
      )?.[0] ?? "";
    expect(wrapper).toContain('name="website"');
    expect(wrapper).toContain('tabindex="-1"');
    expect(wrapper).toContain('autoComplete="off"');
  });

  it("posts a whole page form, so a mistake does not lose the text", async () => {
    const html = await render(<Contact {...props()} />);

    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toContain("Enviar mensaje");
  });

  it("says the message was sent, with no form, and offers to send another", async () => {
    const html = await render(<Contact {...props({ sent: true })} />);

    expect(html).toMatch(/role="status"[^>]*>[^<]*Mensaje enviado/);
    expect(html).toContain("Enviar otro mensaje");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="body"');
  });

  it("gives back what was typed, as text, and says what is wrong", async () => {
    const html = await render(
      <Contact
        {...props(
          {},
          {
            error: "email_invalid",
            values: {
              kind: "help",
              body: "<b>my text</b>",
              replyEmail: "nope",
            },
          },
        )}
      />,
    );

    expect(html).toMatch(/role="alert"[^>]*>[^<]*no parece válido/);
    expect(html).toContain("&lt;b&gt;my text&lt;/b&gt;");
    expect(html).not.toContain("<b>my text");
    expect(inputTag(html, "replyEmail")).toContain('value="nope"');
    expect(inputTag(html, "replyEmail")).toContain('aria-invalid="true"');
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(
      radios
        .filter((r) => r.includes('checked=""'))
        .map((r) => /value="(\w+)"/.exec(r)?.[1]),
    ).toEqual(["help"]);
  });

  it("says each error in words, including the daily limit", async () => {
    for (const [error, text] of [
      ["body_invalid", "mensaje de entre 1 y 2000"],
      ["invalid_request", "No pudimos leer el formulario"],
      ["limit", "demasiados mensajes por hoy"],
    ]) {
      const html = await render(
        <Contact
          {...props(
            {},
            { error, values: { kind: "help", body: "x", replyEmail: "" } },
          )}
        />,
      );
      expect(html).toMatch(new RegExp(`role="alert"[^>]*>[^<]*${text}`));
    }
  });

  it("shows the address by mail and the link to how the message is kept", async () => {
    const html = await render(<Contact {...props()} />);

    expect(html).toContain("contact@sagashelf.app");
    expect(html).toMatch(/<a [^>]*href="\/privacy"/);
  });

  it("is written in English too", async () => {
    const html = await render(<Contact {...props()} />, "en");

    expect(html).toContain("Contact");
    expect(html).toContain("A problem");
    expect(html).toContain("Your email (optional)");
    expect(html).toContain("Send message");
  });
});
