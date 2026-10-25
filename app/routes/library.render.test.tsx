import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Library from "./library";
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

const row = {
  mediaId,
  title: "Ataque a los Titanes",
  type: "anime",
  year: 2013,
  imageUrl: null,
  poster: "/img/tmdb/w185/aot.jpg",
  status: "in_progress" as const,
  progress: 2,
  totalEpisodes: 4,
  score: 8,
};

const libraryProps = (overrides: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Mi biblioteca",
      query: { sort: "recent", page: 1 },
      total: 1,
      pages: 1,
      rows: [row],
      ...overrides,
    },
  }) as unknown as Parameters<typeof Library>[0];

describe("the library page", () => {
  it("shows each entry with its poster, status, progress and score, in Spanish", async () => {
    const html = await render("es", <Library {...libraryProps()} />);

    expect(html).toContain("Mi biblioteca");
    expect(html).toContain("1 título");
    expect(html).toContain("Ataque a los Titanes");
    expect(html).toContain(`href="/library/${mediaId}"`);
    expect(html).toContain('src="/img/tmdb/w185/aot.jpg"');
    expect(html).toContain("Anime · En curso");
    expect(html).toContain("2 de 4 episodios");
    expect(html).toContain("Puntuación: 8 de 10");
  });

  it("shows the same in English", async () => {
    const html = await render("en", <Library {...libraryProps()} />);

    expect(html).toContain("My library");
    expect(html).toContain("1 title");
    expect(html).toContain("Anime · In progress");
    expect(html).toContain("2 of 4 episodes");
  });

  it("invites a person with an empty library to search", async () => {
    const html = await render(
      "es",
      <Library {...libraryProps({ total: 0, rows: [] })} />,
    );

    expect(html).toContain("Tu biblioteca está vacía");
    expect(html).toContain('href="/search"');
  });

  it("says no title matches when filters leave nothing, and offers to clear them", async () => {
    const html = await render(
      "es",
      <Library
        {...libraryProps({
          total: 0,
          rows: [],
          query: { sort: "recent", page: 1, status: "dropped" },
        })}
      />,
    );

    expect(html).toContain("Ningún título coincide con estos filtros.");
    expect(html).toContain("Quitar filtros");
    expect(html).not.toContain("Tu biblioteca está vacía");
  });

  it("links the pages of a long library and keeps the filters", async () => {
    const html = await render(
      "es",
      <Library
        {...libraryProps({
          total: 60,
          pages: 3,
          query: { sort: "score", page: 2, type: "anime" },
        })}
      />,
    );

    expect(html).toContain("Página 2 de 3");
    expect(html).toContain('href="/library?type=anime&amp;sort=score"');
    expect(html).toContain(
      'href="/library?type=anime&amp;sort=score&amp;page=3"',
    );
  });
});

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
        rewatchCount: 0,
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
    expect(html).toContain("Lo has vuelto a ver 0 veces.");
    // Not completed: no button to watch it again.
    expect(html).not.toContain("Volver a verlo");
  });

  it("offers to watch a completed title again, and to remove the entry", async () => {
    const html = await render(
      "es",
      <LibraryEntry
        {...entryProps({ status: "completed", rewatchCount: 1 })}
      />,
    );

    expect(html).toContain('name="intent" value="rewatch"');
    expect(html).toContain("Volver a verlo");
    expect(html).toContain("Lo has vuelto a ver 1 vez.");
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
