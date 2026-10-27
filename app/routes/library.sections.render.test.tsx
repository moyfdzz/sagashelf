import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Library from "./library";
import { resources } from "~/locales";
import {
  libraryQuerySchema,
  sectionOrder,
  type LibraryStatus,
  type LibraryView,
} from "~server/library/schema";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/library", () => ({}));

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

const row = (
  mediaId: string,
  title: string,
  status: LibraryStatus,
  overrides: Record<string, unknown> = {},
) => ({
  mediaId,
  title,
  type: "anime",
  year: 2013,
  imageUrl: null,
  poster: "/img/tmdb/w185/a.jpg",
  status,
  progress: 0,
  totalEpisodes: 0,
  score: null,
  timesWatched: 0,
  ...overrides,
});

type Section = {
  status: LibraryStatus;
  total: number;
  page: number;
  pages: number;
  rows: ReturnType<typeof row>[];
};

function sectionsOf(
  rows: Partial<Record<LibraryStatus, ReturnType<typeof row>[]>>,
  extra: Partial<Record<LibraryStatus, Partial<Section>>> = {},
): Section[] {
  return sectionOrder.map((status) => ({
    status,
    total: rows[status]?.length ?? 0,
    page: 1,
    pages: 1,
    rows: rows[status] ?? [],
    ...extra[status],
  }));
}

function props({
  params = {},
  view = "covers",
  counts = { all: 3, anime: 2, movie: 1, series: 0, book: 0, manga: 0 },
  sections,
}: {
  params?: Record<string, string>;
  view?: LibraryView;
  counts?: Record<string, number>;
  sections: Section[];
}) {
  return {
    loaderData: {
      title: "Mi biblioteca",
      query: libraryQuerySchema.parse(params),
      view,
      counts,
      sections,
    },
  } as unknown as Parameters<typeof Library>[0];
}

const threeEntries = () =>
  sectionsOf({
    in_progress: [row("a", "Ataque a los Titanes", "in_progress")],
    planned: [row("b", "Bleach", "planned")],
    completed: [row("c", "Matrix", "completed", { type: "movie" })],
  });

describe("the tabs", () => {
  it("shows every type with its count, and marks the one that is open", async () => {
    const html = await render(
      "es",
      <Library {...props({ sections: threeEntries() })} />,
    );

    for (const label of [
      "Todos",
      "Anime",
      "Películas",
      "Series",
      "Libros",
      "Manga",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("(3)");
    expect(html).toContain("(0)");
    expect(html).toMatch(/aria-current="page"[^>]*href="\/library"/);
    expect(html).toContain('href="/library?type=book"');
  });

  it("keeps the search and the filters when the tab changes, and starts every section again", async () => {
    const html = await render(
      "es",
      <Library
        {...props({
          params: { q: "dune", score: "8", completed_page: "2" },
          sections: threeEntries(),
        })}
      />,
    );

    expect(html).toContain('href="/library?type=movie&amp;q=dune&amp;score=8"');
  });

  it("says so inside a tab with nothing, instead of hiding it", async () => {
    const html = await render(
      "es",
      <Library
        {...props({
          params: { type: "book" },
          counts: { all: 3, anime: 2, movie: 1, series: 0, book: 0, manga: 0 },
          sections: sectionsOf({}),
        })}
      />,
    );

    expect(html).toContain("Aún no has guardado libros.");
    expect(html).not.toContain("<details");
  });

  it("asks to search when the whole library is empty", async () => {
    const html = await render(
      "es",
      <Library
        {...props({
          counts: { all: 0, anime: 0, movie: 0, series: 0, book: 0, manga: 0 },
          sections: sectionsOf({}),
        })}
      />,
    );

    expect(html).toContain("Tu biblioteca está vacía");
    expect(html).toContain('href="/search"');
  });
});

describe("the sections", () => {
  it("come in a fixed order, each with its count", async () => {
    const html = await render(
      "es",
      <Library {...props({ sections: threeEntries() })} />,
    );

    const order = [
      "En curso",
      "Pendiente",
      "En pausa",
      "Abandonado",
      "Completado",
    ].map((name) => html.indexOf(`>${name}`));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("start open when they have entries, except the completed one", async () => {
    const html = await render(
      "es",
      <Library {...props({ sections: threeEntries() })} />,
    );

    const details = html.match(/<details[^>]*>/g) ?? [];
    expect(details).toHaveLength(5);
    // in progress and planned open; paused, dropped (empty) and completed closed.
    expect(details.map((tag) => tag.includes(" open"))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("open the completed one when the person is searching, or looks at a later page", async () => {
    const searching = await render(
      "es",
      <Library
        {...props({ params: { q: "matrix" }, sections: threeEntries() })}
      />,
    );
    const later = await render(
      "es",
      <Library
        {...props({
          sections: sectionsOf(
            { completed: [row("c", "Matrix", "completed")] },
            { completed: { total: 13, page: 2, pages: 2 } },
          ),
        })}
      />,
    );

    expect((searching.match(/<details[^>]*>/g) ?? [])[4]).toContain(" open");
    expect((later.match(/<details[^>]*>/g) ?? [])[4]).toContain(" open");
  });

  it("say that an empty one has no entries", async () => {
    const es = await render(
      "es",
      <Library {...props({ sections: threeEntries() })} />,
    );
    const en = await render(
      "en",
      <Library {...props({ sections: threeEntries() })} />,
    );

    expect(es).toContain("No tienes entradas en En pausa.");
    expect(es).toContain("No tienes entradas en Abandonado.");
    expect(en).toContain("You have no entries in On hold.");
  });

  it("have their own page links, which keep the search and the other sections", async () => {
    const html = await render(
      "es",
      <Library
        {...props({
          params: { q: "a", planned_page: "2" },
          sections: sectionsOf(
            {
              planned: [row("b", "Bleach", "planned")],
              completed: [row("c", "Matrix", "completed")],
            },
            {
              planned: { total: 20, page: 2, pages: 2 },
              completed: { total: 30, page: 1, pages: 3 },
            },
          ),
        })}
      />,
    );

    expect(html).toContain('aria-label="Páginas de Completado"');
    expect(html).toContain("Página 1 de 3");
    expect(html).toContain(
      'href="/library?q=a&amp;planned_page=2&amp;completed_page=2"',
    );
    // The planned section is on its last page: it can go back, not forward.
    expect(html).toContain('href="/library?q=a"');
    expect(html).toContain('rel="prev"');
  });
});

describe("the search and the filters", () => {
  it("fill the form with what the address says", async () => {
    const html = await render(
      "es",
      <Library
        {...props({
          params: { q: "dune", year: "2021", score: "8", sort: "title" },
          sections: threeEntries(),
        })}
      />,
    );

    expect(html).toContain('role="search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('value="dune"');
    expect(html).toContain('value="2021"');
    expect(html).toContain("Quitar filtros");
  });

  it("say that nothing matches, and how to go back", async () => {
    const html = await render(
      "es",
      <Library
        {...props({
          params: { q: "zzz", type: "anime" },
          counts: { all: 0, anime: 0, movie: 0, series: 0, book: 0, manga: 0 },
          sections: sectionsOf({}),
        })}
      />,
    );

    expect(html).toContain("Ningún título coincide con tu búsqueda.");
    expect(html).toContain('href="/library?type=anime"');
  });
});

describe("the views", () => {
  const html = (view: LibraryView) =>
    render("es", <Library {...props({ view, sections: threeEntries() })} />);

  it("draw covers with the progress and the status", async () => {
    const page = await html("covers");

    expect(page).toContain("<img");
    expect(page).toContain("Anime · En curso");
  });

  it("draw only the titles, with no pictures", async () => {
    const page = await html("titles");

    expect(page).toContain("Ataque a los Titanes");
    expect(page).not.toContain("<img");
  });

  it("draw a grid of covers", async () => {
    const page = await html("grid");

    expect(page).toContain("<img");
    expect(page).toContain("grid-cols-2");
  });

  it("offer the three, and mark the one in use", async () => {
    const page = await html("grid");

    expect(page).toContain('href="/library?view=covers"');
    expect(page).toContain('href="/library?view=titles"');
    expect(page).toMatch(/aria-current="true"[^>]*>Cuadrícula/);
  });
});

describe("the card of an entry", () => {
  const withRow = (extra: Record<string, unknown>) =>
    props({
      sections: sectionsOf({
        in_progress: [
          row("a", "Ataque a los Titanes", "in_progress", {
            progress: 2,
            totalEpisodes: 4,
            score: 8,
            ...extra,
          }),
        ],
      }),
    });

  it("shows the status, the progress and the score, in Spanish and in English", async () => {
    const es = await render("es", <Library {...withRow({})} />);
    const en = await render("en", <Library {...withRow({})} />);

    expect(es).toContain("Anime · En curso");
    expect(es).toContain("2 de 4 episodios");
    expect(es).toContain("Puntuación: 8 de 10");
    expect(en).toContain("Anime · In progress");
    expect(en).toContain("2 of 4 episodes");
    expect(en).toContain("My library");
  });

  it("says how many times a title was watched, only when it was", async () => {
    const once = await render(
      "es",
      <Library {...withRow({ timesWatched: 1 })} />,
    );
    const many = await render(
      "en",
      <Library {...withRow({ timesWatched: 3 })} />,
    );
    const never = await render("es", <Library {...withRow({})} />);

    expect(once).toContain("Lo has visto 1 vez");
    expect(many).toContain("You have watched it 3 times");
    expect(never).not.toContain("Lo has visto");
  });
});

describe("the entries", () => {
  it("link to the page of the entry with a plain link", async () => {
    const page = await render(
      "es",
      <Library {...props({ sections: threeEntries() })} />,
    );

    expect(page).toContain('href="/library/a"');
    expect(page).toContain("(2013)");
  });
});
