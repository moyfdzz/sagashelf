import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import LibraryEntry from "./library.$mediaId";
import MediaDetail from "./media.$type.$slug";
import { resources } from "~/locales";

// The loaders and actions are tested in their own files; here only the pages are drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));

// Clerk's script is not what these tests are about.
vi.mock("~/components/ClerkSession", () => ({
  ClerkSession: ({ children }: { children: ReactNode }) => children,
}));

async function render(
  locale: "es" | "en",
  element: ReactNode,
  path = "/",
): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter([{ path, element }], {
    initialEntries: [path],
  });
  return renderToString(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

// The library page has its own file: library.sections.render.test.tsx.

const entryProps = (
  entry: Record<string, unknown> = {},
  actionData?: unknown,
  extra: Record<string, unknown> = {},
) =>
  ({
    loaderData: {
      title: "Mi biblioteca",
      publishableKey: "publishable-key-for-tests",
      entry: {
        mediaId,
        status: "in_progress",
        progress: 2,
        score: 8,
        startedAt: "2026-01-02",
        finishedAt: null,
        notes: "una nota",
        visibility: "private",
        ...entry,
      },
      media: {
        title: "Ataque a los Titanes",
        type: "anime",
        year: 2013,
        poster: "/img/tmdb/w185/aot.jpg",
        detailPath: `/media/anime/ataque-a-los-titanes-${mediaId}`,
      },
      viewings: [],
      timesWatched: 0,
      totalEpisodes: 4,
      progressAt: { season: 1, episode: 2 },
      ...extra,
    },
    actionData,
  }) as unknown as Parameters<typeof LibraryEntry>[0];

describe("the entry page", () => {
  it("shows the fields with what is saved and where the progress leaves the person", async () => {
    const html = await render("es", <LibraryEntry {...entryProps()} />);

    expect(html).toContain("Ataque a los Titanes");
    expect(html).toContain('name="intent" value="save"');
    expect(html).toContain(
      '<option value="in_progress" selected="">En curso</option>',
    );
    expect(html).toContain('value="2"');
    expect(html).toContain("De 4 episodios.");
    expect(html).toContain("Vas en la temporada 1, episodio 2.");
    expect(html).toContain('<option value="8" selected="">8 de 10</option>');
    expect(html).toContain('value="2026-01-02"');
    expect(html).toContain(">una nota</textarea>");
    expect(html).toContain("Lo has visto 0 veces.");
    // Not completed: no button to watch it again.
    expect(html).not.toContain("Volver a verlo");
  });

  it("has no maxlength on the notes, and no count until a script can update it", async () => {
    const html = await render("es", <LibraryEntry {...entryProps()} />);

    const notes = /<textarea[^>]*id="notes"[^>]*>/.exec(html)?.[0] ?? "";
    expect(notes).toBeTruthy();
    expect(notes).not.toContain("maxLength");
    expect(notes).not.toContain("maxlength");
    // The hint stays; the count is drawn after the page has loaded.
    expect(html).toContain("Hasta 2000 caracteres.");
    expect(html).not.toContain('id="notes-count"');
  });

  it("lets the finish date be set only while the title is completed", async () => {
    const open = await render("es", <LibraryEntry {...entryProps()} />);
    const done = await render(
      "es",
      <LibraryEntry {...entryProps({ status: "completed" })} />,
    );

    const finishField = (html: string) =>
      /<input id="finishedAt"[^>]*>/.exec(html)?.[0] ?? "";
    expect(finishField(open)).toContain('disabled=""');
    expect(finishField(done)).not.toContain('disabled=""');
    expect(open).toContain(
      "Solo se puede poner cuando el estado es Completado.",
    );
  });

  it("offers to watch a completed title again, and to remove the entry", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps({ status: "completed" }, undefined, {
          viewings: [
            {
              id: "0199a3c2-7d4e-7b1a-8c3f-bbbbbbbbbbbb",
              startedOn: "2025-05-01",
              finishedOn: "2025-05-03",
              notes: "En el cine",
            },
          ],
          timesWatched: 2,
        })}
      />,
    );

    expect(html).toContain('name="intent" value="rewatch"');
    expect(html).toContain("Volver a verlo");
    expect(html).toContain("Lo has visto 2 veces.");
    expect(html).toContain("Del 1 de mayo de 2025 al 3 de mayo de 2025");
    expect(html).toContain("En el cine");
    expect(html).toContain('name="intent" value="viewing_add"');
    expect(html).toContain('value="viewing_save"');
    expect(html).toContain('value="viewing_remove"');
    expect(html).toContain('name="intent" value="remove"');
    expect(html).toContain("Quitar de mi biblioteca");
  });

  it("does not ask for episodes of a title that has none", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps({ progress: 0 }, undefined, {
          totalEpisodes: 0,
          progressAt: null,
        })}
      />,
    );

    expect(html).not.toContain('id="progress"');
    expect(html).toContain('type="hidden" name="progress" value="0"');
  });

  it("marks the field of an error, with its message", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps(
          {},
          { ok: false, errors: { progress: "progress_too_high" } },
        )}
      />,
    );

    expect(html).toContain("Revisa los campos marcados.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="progress-error"');
    expect(html).toContain("El progreso supera los episodios del título.");
  });

  it("announces that it saved", async () => {
    const html = await render(
      "en",
      <LibraryEntry
        {...entryProps({}, { ok: true, saved: "save", savedAt: 1 })}
      />,
    );

    expect(html).toContain("Your entry was saved.");
  });
});

const detailProps = (library: Record<string, unknown>) =>
  ({
    loaderData: {
      id: mediaId,
      library,
      type: "anime",
      title: "Ataque a los Titanes",
      pageTitle: "Ataque a los Titanes | SagaShelf",
      originalTitle: null,
      year: 2013,
      status: "finished",
      synopsis: "Sinopsis",
      synopsisLocale: "es",
      description: "Sinopsis",
      poster: null,
      seasons: [],
      sourceUrl: null,
      canonicalUrl: "https://sagashelf.app/x",
      shareImageUrl: null,
      jsonLd: {},
    },
  }) as unknown as Parameters<typeof MediaDetail>[0];

describe("the library block of the title page", () => {
  it("lets a signed-in person add the title with a form that reloads the page", async () => {
    const html = await render(
      "es",
      <MediaDetail {...detailProps({ signedIn: true, status: null })} />,
    );

    expect(html).toContain('action="/library/add"');
    expect(html).toContain('method="post"');
    expect(html).toContain(`name="mediaId" value="${mediaId}"`);
    expect(html).toContain("Añadir a mi biblioteca");
  });

  it("shows the status and a plain link to the entry when it is already there", async () => {
    const html = await render(
      "es",
      <MediaDetail {...detailProps({ signedIn: true, status: "completed" })} />,
    );

    expect(html).toContain("En tu biblioteca: Completado");
    expect(html).toContain(`href="/library/${mediaId}"`);
    expect(html).not.toContain("Añadir a mi biblioteca");
  });

  it("sends a visitor to sign in", async () => {
    const html = await render(
      "en",
      <MediaDetail
        {...detailProps({
          signedIn: false,
          status: null,
          signInPath: "/sign-in?redirectTo=%2Fmedia%2Fx",
        })}
      />,
    );

    expect(html).toContain('href="/sign-in?redirectTo=%2Fmedia%2Fx"');
    expect(html).toContain("Sign in to add this title to your library");
    expect(html).not.toContain("Add to my library");
  });
});
