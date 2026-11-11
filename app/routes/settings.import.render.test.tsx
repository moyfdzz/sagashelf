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

const props = (actionData?: unknown, progress: unknown = null, page = 1) =>
  ({
    loaderData: {
      title: "Importar tu biblioteca",
      publishableKey: "publishable-key-for-tests",
      perDay: 300,
      skippedPage: page,
      progress,
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
            perDay: 300,
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

  it("says that updating the titles you have deletes nothing, and which ones change (SAG-248)", async () => {
    const preview = {
      ok: true,
      step: "preview" as const,
      payload: "{}",
      preview: {
        add: 1,
        exists: 1,
        fetch: 0,
        shared: { public: 0, friends: 0 },
        skipped: [],
      },
    };
    const es = await render("es", <SettingsImport {...props(preview)} />);
    const en = await render("en", <SettingsImport {...props(preview)} />);

    expect(es).toContain(
      "Actualizar los títulos que ya tengo con los datos del archivo",
    );
    expect(es).toContain("Solo cambia los títulos que están en tu biblioteca");
    expect(es).toContain("No se borra nada.");
    expect(es).not.toContain("Reemplazar");
    expect(en).toContain(
      "Update the titles I already have with the data from the file",
    );
    expect(en).toContain("Nothing is deleted.");
    expect(en).not.toContain("Replace what");
  });

  it("says that titles were updated with the data from the file, not replaced (SAG-248)", async () => {
    const done = (replaced: number) =>
      props({
        ok: true,
        step: "done",
        result: { added: 0, replaced, kept: 0, queued: 0, skipped: [] },
      });
    const one = await render("es", <SettingsImport {...done(1)} />);
    const many = await render("en", <SettingsImport {...done(3)} />);

    expect(one).toContain("Se actualizó 1 título con los datos del archivo.");
    expect(many).toContain(
      "3 titles were updated with the data from the file.",
    );
  });

  it("says what was imported right away", async () => {
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
            queued: 0,
            skipped: [],
          },
        })}
      />,
    );

    expect(html).toContain("1 title was added.");
    expect(html).toContain("2 titles you already had stayed as they were.");
    expect(html).toContain('href="/library"');
  });

  it("draws the way back as a back link and the next step as a button", async () => {
    const page = await render("es", <SettingsImport {...props()} />);
    const done = await render(
      "es",
      <SettingsImport
        {...props({
          ok: true,
          step: "done",
          result: { added: 1, replaced: 0, kept: 0, queued: 0, skipped: [] },
        })}
      />,
    );

    const back = /<a[^>]*href="\/settings\/profile#data"[^>]*>/.exec(page)?.[0];
    const library = /<a[^>]*href="\/library"[^>]*>/.exec(done)?.[0];
    // A back link is a link with an arrow (SAG-156), not a button.
    expect(back).toContain("hover:text-link-hover");
    expect(back).not.toContain("border-input-edge");
    expect(page).toMatch(
      /<a[^>]*href="\/settings\/profile#data"[^>]*><svg[^>]*lucide-arrow-left/,
    );
    expect(library).toContain("border-input-edge");
    expect(library).toContain("whitespace-nowrap");
    expect(library).not.toContain("underline");
  });

  it("shows the message of an error", async () => {
    const html = await render(
      "es",
      <SettingsImport {...props({ ok: false, error: "too_many" })} />,
    );

    expect(html).toContain(
      "El archivo tiene demasiados títulos (máximo 5000).",
    );
  });

  it("shows how far the latest import is and which titles went wrong, in both languages (SAG-241)", async () => {
    const progress = {
      total: 10,
      pending: 3,
      skippedCount: 2,
      skipped: [
        { title: "Titulo uno", reason: "not_found" },
        { title: "Titulo dos", reason: "failed" },
      ],
    };

    const es = await render(
      "es",
      <SettingsImport {...props(undefined, progress)} />,
    );
    const en = await render(
      "en",
      <SettingsImport {...props(undefined, progress)} />,
    );

    expect(es).toContain("5 de 10 títulos ya están en tu biblioteca.");
    expect(es).toContain("Faltan 3 títulos por buscar.");
    expect(es).toContain("hasta 300 títulos nuevos al día");
    expect(es).toContain("No se pudieron importar 2 títulos.");
    expect(es).toContain("Titulo uno: la fuente no lo encontró");
    expect(es).toContain("Titulo dos: la fuente no respondió");
    expect(en).toContain("5 of 10 titles are already in your library.");
    expect(en).toContain("2 titles could not be imported.");
  });

  it("shows a bar with the share of the titles that are dealt with while some wait, and none when it is over (SAG-242)", async () => {
    const waiting = await render(
      "es",
      <SettingsImport
        {...props(undefined, {
          total: 200,
          pending: 50,
          // The 20 that failed are dealt with too, so they count toward the bar.
          skippedCount: 20,
          skipped: [],
        })}
      />,
    );
    const over = await render(
      "es",
      <SettingsImport
        {...props(undefined, {
          total: 200,
          pending: 0,
          skippedCount: 0,
          skipped: [],
        })}
      />,
    );

    expect(waiting).toContain(
      '<progress aria-hidden="true" value="150" max="200"',
    );
    expect(waiting).toContain("75% de los títulos ya está listo.");
    expect(over).not.toContain("<progress");
    expect(over).not.toContain("ya está listo.");
  });

  it("lists the titles that failed a page at a time, with links that keep the place (SAG-242)", async () => {
    const skipped = Array.from({ length: 50 }, (_, i) => ({
      title: `Titulo ${i + 51}`,
      reason: "not_found",
    }));
    const html = await render(
      "es",
      <SettingsImport
        {...props(
          undefined,
          { total: 120, pending: 0, skippedCount: 120, skipped },
          2,
        )}
      />,
    );

    expect(html).toContain("Titulo 51: la fuente no lo encontró");
    expect(html).toContain('href="/settings/import?page=1#import-progress"');
    expect(html).toContain('href="/settings/import?page=3#import-progress"');
    expect(html).not.toContain("Y 70 más");
  });

  it("still shows the way back from a page past the last one (SAG-242)", async () => {
    const html = await render(
      "es",
      <SettingsImport
        {...props(
          undefined,
          { total: 5, pending: 0, skippedCount: 2, skipped: [] },
          7,
        )}
      />,
    );

    expect(html).toContain('href="/settings/import?page=6#import-progress"');
    expect(html).not.toContain("?page=8");
  });

  it("shows no link to another page when every failed title fits in one", async () => {
    const html = await render(
      "es",
      <SettingsImport
        {...props(undefined, {
          total: 5,
          pending: 0,
          skippedCount: 2,
          skipped: [
            { title: "Uno", reason: "not_found" },
            { title: "Dos", reason: "failed" },
          ],
        })}
      />,
    );

    expect(html).not.toContain("?page=");
  });

  it("says the import is finished, with no warning, when nothing waits and nothing failed", async () => {
    const html = await render(
      "es",
      <SettingsImport
        {...props(undefined, {
          total: 4,
          pending: 0,
          skippedCount: 0,
          skipped: [],
        })}
      />,
    );

    expect(html).toContain("4 de 4 títulos ya están en tu biblioteca.");
    expect(html).toContain("La importación terminó.");
    expect(html).not.toContain("No se pudieron importar");
  });

  it("counts the titles that wait in the queue after an upload", async () => {
    const html = await render(
      "es",
      <SettingsImport
        {...props({
          ok: true,
          step: "done",
          result: { added: 1, replaced: 0, kept: 0, queued: 6, skipped: [] },
        })}
      />,
    );

    expect(html).toContain("6 títulos se están buscando en segundo plano.");
  });

  describe("the titles left out (SAG-243)", () => {
    const previewOf = (count: number, match = 0) => ({
      ok: true,
      step: "preview",
      payload: "{}",
      preview: {
        add: 0,
        exists: 0,
        perDay: 300,
        fetch: 0,
        match,
        shared: { public: 0, friends: 0 },
        skipped: Array.from({ length: count }, (_, i) => ({
          title: `Titulo ${i + 1}`,
          reason: "no_source",
        })),
      },
    });

    it("says how many were not imported, in both languages and in the singular", async () => {
      const many = await render(
        "es",
        <SettingsImport {...props(previewOf(3))} />,
      );
      const one = await render(
        "es",
        <SettingsImport {...props(previewOf(1))} />,
      );
      const english = await render(
        "en",
        <SettingsImport {...props(previewOf(2))} />,
      );

      expect(many).toContain("No se importaron 3 títulos");
      expect(one).toContain("No se importó 1 título");
      expect(english).toContain("2 titles were not imported");
    });

    it("shows a short list open and folds a long one behind its count", async () => {
      const short = await render(
        "es",
        <SettingsImport {...props(previewOf(10))} />,
      );
      const long = await render(
        "es",
        <SettingsImport {...props(previewOf(11))} />,
      );

      expect(short).toMatch(/<details[^>]* open=""/);
      expect(long).not.toMatch(/<details[^>]* open/);
      // Folded up, the titles are still in the page for a person who opens it.
      expect(long).toContain("Titulo 11: sin el identificador del catálogo");
    });

    it("keeps a later page of the failed titles open", async () => {
      const skipped = Array.from({ length: 50 }, (_, i) => ({
        title: `Titulo ${i + 51}`,
        reason: "not_found",
      }));
      const html = await render(
        "es",
        <SettingsImport
          {...props(
            undefined,
            { total: 120, pending: 0, skippedCount: 120, skipped },
            2,
          )}
        />,
      );

      expect(html).toContain("No se importaron 120 títulos");
      expect(html).toMatch(/<details[^>]* open=""/);
    });

    it("tells that titles with no id will be looked up by name and year", async () => {
      const html = await render(
        "es",
        <SettingsImport {...props(previewOf(0, 2))} />,
      );

      expect(html).toContain("2 títulos no traen el id del catálogo");
      expect(html).toContain("Varias temporadas de una misma serie se juntan");
    });
  });
});
