import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminModeration from "./admin.moderation";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("@clerk/backend", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/auth/admin-write", () => ({}));
vi.mock("~server/db/moderation", () => ({}));
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
const photo = "https://img.clerk.com/photo-one";

const report = (fields: Record<string, unknown> = {}) => ({
  id,
  kind: "picture",
  reason: "violent",
  details: null,
  createdAt: Date.parse("2026-11-06T12:00:00Z"),
  username: "bob",
  pictureUrl: photo,
  hidden: false,
  current: true,
  sensitive: false,
  ...fields,
});

const props = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Moderación",
      publishableKey: "pk_test_x",
      notice: null,
      error: null,
      confirm: null,
      reports: [report()],
      uploads: [],
      ...extra,
    },
  }) as unknown as Parameters<typeof AdminModeration>[0];

const intents = (html: string) =>
  [...html.matchAll(/name="intent" value="(\w+)"/g)].map((m) => m[1]);

describe("the moderation panel (SAG-143)", () => {
  it("draws a visible picture with no referrer, and offers to dismiss it or to remove it", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toMatch(
      new RegExp(`<img [^>]*src="${photo}"[^>]*referrerPolicy="no-referrer"`),
    );
    expect(html).toContain("Violenta u ofensiva");
    expect(intents(html)).toEqual(["dismiss"]);
    expect(html).toContain(`href="/admin/moderation?confirm=${id}"`);
    expect(html).toMatch(/<a [^>]*href="\/u\/bob"/);
  });

  it("does not draw a picture reported for minors, and asks for a click to see it", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          reports: [
            report({
              reason: "sexual_minors",
              pictureUrl: null,
              hidden: true,
              sensitive: true,
            }),
          ],
        })}
      />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("Reportada por menores: no se muestra de entrada.");
    expect(html).toContain(`href="/admin/moderation?view=${id}"`);
    expect(html).toContain("La foto está oculta para todos");
  });

  it("offers to restore a hidden picture and never to dismiss it", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          reports: [
            report({ reason: "sexual_minors", hidden: true, sensitive: true }),
          ],
        })}
      />,
    );

    expect(html).toContain("<img");
    expect(intents(html)).toEqual(["restore"]);
    expect(html).toContain("Quitar la foto");
  });

  it("offers only to dismiss a report of a picture the person has replaced", async () => {
    const html = await render(
      <AdminModeration {...props({ reports: [report({ current: false })] })} />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("ya cambió de foto");
    expect(intents(html)).toEqual(["dismiss"]);
    expect(html).not.toContain("?confirm=");
  });

  it("offers only to dismiss a report of a person, with what the reporter wrote", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          reports: [
            report({
              kind: "user",
              reason: "spam",
              details: "sells things",
              pictureUrl: null,
              current: false,
            }),
          ],
        })}
      />,
    );

    expect(html).toContain("Persona");
    expect(html).toContain("Spam");
    expect(html).toContain("sells things");
    expect(intents(html)).toEqual(["dismiss"]);
  });

  it("asks before removing, with a button that sends the removal and a way back", async () => {
    const html = await render(<AdminModeration {...props({ confirm: id })} />);

    expect(html).toContain("Se borra también en Clerk");
    expect(intents(html)).toEqual(["remove"]);
    expect(html).toContain("Sí, quitar la foto");
    expect(html).toMatch(/<a [^>]*href="\/admin\/moderation"[^>]*>No, volver/);
  });

  it("does not ask to remove a report that cannot be removed, even if the address says so", async () => {
    const html = await render(
      <AdminModeration
        {...props({ confirm: id, reports: [report({ current: false })] })}
      />,
    );

    expect(intents(html)).toEqual(["dismiss"]);
  });

  it("sends the id and the action as hidden fields of a POST, and nothing else", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toMatch(/<form [^>]*method="post"/);
    expect(html).toContain(`name="id" value="${id}"`);
  });

  it("says a reason that has no text instead of breaking", async () => {
    const html = await render(
      <AdminModeration
        {...props({ reports: [report({ reason: "copyright" })] })}
      />,
    );

    expect(html).toContain("Motivo sin texto");
  });

  it("lists the uploads with their answer, their score and the date", async () => {
    const html = await render(
      <AdminModeration
        {...props({
          uploads: [
            {
              id: "u1",
              username: "carl",
              result: "rejected",
              score: 0.93,
              createdAt: Date.parse("2026-11-06T10:00:00Z"),
            },
            {
              id: "u2",
              username: "dana",
              result: "allowed",
              score: 0.4,
              createdAt: Date.parse("2026-11-06T09:00:00Z"),
            },
          ],
        })}
      />,
    );

    expect(html).toContain("carl");
    expect(html).toContain("Rechazada");
    expect(html).toContain("Puntaje 0,93");
    expect(html).toContain("Aceptada, cerca del límite");
  });

  it("says what happened, and why an action did not", async () => {
    const done = await render(
      <AdminModeration {...props({ notice: "restored" })} />,
    );
    const failed = await render(
      <AdminModeration {...props({ error: "failed" })} />,
    );

    expect(done).toMatch(/role="status"[^>]*>[^<]*se muestra otra vez/);
    expect(failed).toMatch(/role="alert"[^>]*>[^<]*Clerk no quitó la foto/);
  });

  it("says there is nothing to review when there is nothing", async () => {
    const html = await render(<AdminModeration {...props({ reports: [] })} />);

    expect(html).toContain("No hay reportes abiertos.");
    expect(html).toContain("No hay intentos que revisar.");
  });

  it("links both sections of the administration with plain anchors", async () => {
    const html = await render(<AdminModeration {...props()} />);

    expect(html).toMatch(/<a [^>]*href="\/admin\/sagas"/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/moderation"[^>]*aria-current="page"/,
    );
  });

  it("is written in English for an English page", async () => {
    const html = await render(<AdminModeration {...props()} />, "en");

    expect(html).toContain("Open reports");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Remove the picture");
  });
});
