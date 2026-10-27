import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import SettingsImport from "./settings.import";
import { resources } from "~/locales";

// The loader and the action are tested in their own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => children,
}));

async function render(
  locale: "es" | "en",
  element: ReactNode,
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

const props = (actionData?: unknown) =>
  ({
    loaderData: {
      title: "Importar tu biblioteca",
      publishableKey: "publishable-key-for-tests",
    },
    actionData,
  }) as unknown as Parameters<typeof SettingsImport>[0];

describe("the import page", () => {
  it("asks for a file, in both languages", async () => {
    const es = await render("es", <SettingsImport {...props()} />);
    const en = await render("en", <SettingsImport {...props()} />);

    expect(es).toContain("Importar tu biblioteca");
    expect(es).toContain('type="file"');
    expect(es).toContain("multipart/form-data");
    expect(es).toContain('name="intent" value="preview"');
    expect(en).toContain("Import your library");
  });

  it("shows what would happen and asks to confirm, with the file kept for the next step", async () => {
    const html = await render(
      "es",
      <SettingsImport
        {...props({
          ok: true,
          step: "preview",
          payload: '{"schemaVersion":1}',
          preview: {
            add: 2,
            exists: 1,
            fetch: 3,
            shared: { public: 2, friends: 1 },
            skipped: [{ title: "Algo raro", reason: "invalid" }],
          },
        })}
      />,
    );

    expect(html).toContain("Se añadirán 2 títulos a tu biblioteca.");
    expect(html).toContain("Ya tienes 1 título en tu biblioteca.");
    expect(html).toContain("3 títulos aún no están en SagaShelf");
    expect(html).toContain("Algo raro: datos no válidos");
    expect(html).toContain('name="intent" value="confirm"');
    expect(html).toContain('name="replace"');
    expect(html).toContain(
      "2 de los títulos nuevos son públicos en el archivo. Quedarán privados si no marcas la casilla de abajo.",
    );
    expect(html).toContain("1 de los títulos nuevos es para amigos");
    expect(html).toContain("Conservar la visibilidad del archivo");
  });

  it("leaves the box to keep the visibility unchecked, and says nothing of it when nothing is shared", async () => {
    const html = await render(
      "en",
      <SettingsImport
        {...props({
          ok: true,
          step: "preview",
          payload: "{}",
          preview: {
            add: 1,
            exists: 0,
            fetch: 0,
            shared: { public: 0, friends: 0 },
            skipped: [],
          },
        })}
      />,
    );

    const boxOf = (name: string) =>
      new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
    // Both boxes have the same size and do not shrink next to a long hint.
    for (const name of ["replace", "keepVisibility"]) {
      expect(boxOf(name)).toContain("h-5 w-5 shrink-0");
    }

    const box = boxOf("keepVisibility");
    expect(box).toContain('type="checkbox"');
    expect(box).not.toContain("checked");
    expect(html).toContain("Keep the visibility stored in the file");
    expect(html).not.toContain("in the file. It will be private");
    expect(html).not.toContain("in the file. They will be private");
  });

  it("says what was imported and what was not", async () => {
    const html = await render(
      "en",
      <SettingsImport
        {...props({
          ok: true,
          step: "done",
          result: {
            added: 1,
            replaced: 0,
            kept: 2,
            skipped: [{ title: "Matrix", reason: "pending" }],
          },
        })}
      />,
    );

    expect(html).toContain("1 title was added.");
    expect(html).toContain("2 titles you already had stayed as they were.");
    expect(html).toContain("Matrix: pending: import the file again");
    expect(html).toContain('href="/library"');
  });

  it("shows the message of an error", async () => {
    const html = await render(
      "es",
      <SettingsImport {...props({ ok: false, error: "too_many" })} />,
    );

    expect(html).toContain("El archivo tiene demasiados títulos (máximo 500).");
  });
});
