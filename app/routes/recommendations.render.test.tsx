import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Recommendations from "./recommendations";
import { resources } from "~/locales";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/recommendations", () => ({}));
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

const props = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Recomendaciones | SagaShelf",
      likedGenres: 2,
      genres: [
        {
          mediaId: "m1",
          type: "anime",
          title: "Death Note",
          year: 2006,
          href: "/media/anime/death-note-m1",
          because: ["mystery", "psychological", "thriller"],
        },
        {
          mediaId: "m2",
          type: "movie",
          title: "Se7en",
          year: null,
          href: "/media/movie/se7en-m2",
          because: ["thriller"],
        },
      ],
      sagas: [
        {
          slug: "berserk",
          title: "Berserk",
          more: 2,
          items: [
            {
              qid: "Q1",
              label: "Berserk (manga)",
              format: "manga",
              year: 1989,
              href: "/media/manga/berserk-m3",
            },
            {
              qid: "Q2",
              label: "Berserk: the game",
              format: "game",
              year: 2004,
              href: null,
            },
          ],
        },
      ],
      ...extra,
    },
  }) as unknown as Parameters<typeof Recommendations>[0];

describe("the recommendations page (SAG-87)", () => {
  it("lists the titles by genre, each linked, with its kind, its year and the reason", async () => {
    const html = await render(<Recommendations {...props()} />);

    expect(html).toContain("Recomendaciones");
    expect(html).toContain("Por tus géneros");
    expect(html).toMatch(
      /<a [^>]*href="\/media\/anime\/death-note-m1"[^>]*>Death Note<\/a>/,
    );
    expect(html).toContain("Anime");
    expect(html).toContain("(2006)");
    expect(html).toContain(
      "Porque te gustan: Misterio, Psicológico y Thriller",
    );
    expect(html).toContain("Porque te gustan: Thriller");
  });

  it("says the reason in English, with the list written the English way", async () => {
    const html = await render(<Recommendations {...props()} />, "en");

    expect(html).toContain("By your genres");
    expect(html).toMatch(
      /Because you like: Mystery, Psychological,? and Thriller/,
    );
  });

  it("lists what is missing of each saga, linking only the works the catalog holds", async () => {
    const html = await render(<Recommendations {...props()} />);

    expect(html).toContain("Te falta de tus sagas");
    expect(html).toMatch(/<a [^>]*href="\/sagas\/berserk"[^>]*>Berserk<\/a>/);
    expect(html).toMatch(
      /<a [^>]*href="\/media\/manga\/berserk-m3"[^>]*>Berserk \(manga\)<\/a>/,
    );
    expect(html).toContain("Berserk: the game");
    expect(html).not.toMatch(/<a [^>]*>Berserk: the game<\/a>/);
    expect(html).toContain("y 2 obras más");
    expect(html).toContain(
      "Las obras sin enlace todavía no están en el catálogo",
    );
  });

  it("says nothing about kinds it has no name for, such as a game", async () => {
    const html = await render(<Recommendations {...props()} />);

    expect(html).toContain("(2004)");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("asks a person with no taste yet to score or finish something, with a link to the search", async () => {
    const html = await render(
      <Recommendations {...props({ likedGenres: 0, genres: [], sagas: [] })} />,
    );

    expect(html).toContain("Todavía no sabemos qué géneros te gustan");
    expect(html).toMatch(/<a [^>]*href="\/search"/);
    expect(html).not.toContain("Te falta de tus sagas");
  });

  it("says there is nothing new when the person has a taste but the catalog has nothing else", async () => {
    const html = await render(
      <Recommendations {...props({ likedGenres: 3, genres: [] })} />,
    );

    expect(html).toContain("no hay títulos nuevos en tus géneros");
    expect(html).not.toContain("Todavía no sabemos");
  });

  it("leaves out the sagas section when no saga was started", async () => {
    const html = await render(<Recommendations {...props({ sagas: [] })} />);

    expect(html).not.toContain("Te falta de tus sagas");
    expect(html).not.toContain("Las obras sin enlace");
  });

  it("does not say how many works are left when the list shows all of them", async () => {
    const html = await render(
      <Recommendations
        {...props({
          sagas: [
            {
              slug: "x",
              title: "X",
              more: 0,
              items: [
                {
                  qid: "Q1",
                  label: "One",
                  format: "movie",
                  year: null,
                  href: null,
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(html).not.toMatch(/obras? más/);
  });
});
