import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import TrendingPage from "./trending";
import { resources } from "~/locales";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/trending/page", () => ({}));

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

const card = (title: string, extra: Record<string, unknown> = {}) => ({
  href: `/media/movie/${title.toLowerCase().replace(/ /g, "-")}-id`,
  title,
  poster: `/img/tmdb/w185/${title.length}.jpg`,
  people: 4,
  average: null,
  ...extra,
});

const tmdb = {
  name: "TMDB",
  url: "https://www.themoviedb.org",
  notice:
    "This product uses the TMDB API but is not endorsed or certified by TMDB.",
  logo: "/tmdb-logo.svg",
};

const props = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      pageTitle: "Tendencias | SagaShelf",
      description: "",
      canonicalUrl: "https://sagashelf.app/trending",
      view: { type: "movie", period: "week" },
      pastYears: [],
      minPeople: 3,
      site: {
        mostAdded: [card("Dune"), card("Arrival", { people: 1 })],
        mostCompleted: [card("Heat", { people: 3 })],
        bestRated: [card("Alien", { people: 5, average: 9.25 })],
      },
      worldwide: {
        status: "ok",
        source: tmdb,
        titles: [
          {
            href: "/media/open?provider=tmdb&id=movie%2F603",
            title: "The Matrix",
            year: 1999,
            poster: "/img/tmdb/w185/matrix.jpg",
          },
          {
            href: "/media/open?provider=tmdb&id=movie%2F1",
            title: "Sin póster ni año",
            year: null,
            poster: null,
          },
        ],
      },
      ...extra,
    },
  }) as unknown as Parameters<typeof TrendingPage>[0];

const nothing = { mostAdded: [], mostCompleted: [], bestRated: [] };

describe("the trending page (SAG-23)", () => {
  it("draws the three lists of the site as ordered lists, with how many people", async () => {
    const html = await render("es", <TrendingPage {...props()} />);

    expect(html).toContain("<h1");
    expect(html).toContain("Tendencias");
    expect(html).toContain("En SagaShelf");
    for (const heading of [
      "Más agregados",
      "Más completados",
      "Mejor calificados",
    ]) {
      expect(html).toContain(heading);
    }
    expect(html.match(/<ol /g)?.length).toBe(4);
    expect(html).toContain('href="/media/movie/dune-id"');
    expect(html).toContain("4 personas");
    expect(html).toContain("1 persona<");
    expect(html).toContain("9,3 de 10 · 5 personas");
    expect(html).toContain('src="/img/tmdb/');
  });

  it("says in English how many people and the score out of ten", async () => {
    const html = await render("en", <TrendingPage {...props()} />);

    expect(html).toContain("Trending");
    expect(html).toContain("4 people");
    expect(html).toContain("1 person<");
    expect(html).toContain("9.3 out of 10 · 5 people");
    expect(html).toContain("Most added");
  });

  it("marks the type and the period that are shown, and links to the others", async () => {
    const html = await render(
      "es",
      <TrendingPage {...props({ view: { type: "anime", period: "month" } })} />,
    );

    expect(html.match(/aria-current="page"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-current="page"[^>]*>Anime</);
    expect(html).toMatch(/aria-current="page"[^>]*>Último mes</);
    expect(html).toContain('href="/trending?type=anime"');
    expect(html).toContain('href="/trending?type=anime&amp;period=year"');
    expect(html).toContain('href="/trending?period=month"');
  });

  it("offers each past year as a link, and none when there is none", async () => {
    const without = await render("es", <TrendingPage {...props()} />);
    expect(without).not.toContain("period=20");

    const html = await render(
      "es",
      <TrendingPage
        {...props({
          view: { type: "movie", period: "2027" },
          pastYears: [2027, 2026],
        })}
      />,
    );
    expect(html).toContain('href="/trending?period=2026"');
    expect(html).toMatch(/aria-current="page"[^>]*>2027</);
  });

  it("says there is not enough data when no list has a title, and why", async () => {
    const html = await render(
      "es",
      <TrendingPage {...props({ site: nothing })} />,
    );

    expect(html).toContain("Todavía no hay suficientes datos");
    expect(html).toContain("al menos 3 personas");
    expect(html).not.toContain("Más agregados");
  });

  it("says which list is empty when only some of them are", async () => {
    const html = await render(
      "es",
      <TrendingPage
        {...props({
          site: { ...nothing, mostAdded: [card("Dune")] },
        })}
      />,
    );

    expect(html).toContain("Más agregados");
    expect(html).toContain("Ningún título llega todavía a 3 personas");
  });

  it("shows the worldwide list with its source, the logo and the notice TMDB requires", async () => {
    const html = await render("es", <TrendingPage {...props()} />);

    expect(html).toContain("En el mundo");
    expect(html).toContain("según TMDB");
    expect(html).toContain(
      'href="/media/open?provider=tmdb&amp;id=movie%2F603"',
    );
    expect(html).toContain("1999");
    expect(html).toContain('src="/tmdb-logo.svg"');
    expect(html).toContain('href="https://www.themoviedb.org"');
    expect(html).toContain(
      `lang="en" class="text-fg-muted text-sm">${tmdb.notice}`,
    );
  });

  it("keeps the notice in English also on the Spanish page", async () => {
    const html = await render("es", <TrendingPage {...props()} />);

    expect(html).toContain("This product uses the TMDB API");
  });

  it("says the worldwide list is empty, with no poster to draw", async () => {
    const html = await render(
      "es",
      <TrendingPage
        {...props({ worldwide: { status: "ok", source: tmdb, titles: [] } })}
      />,
    );

    expect(html).toContain("La lista del mundo está vacía por ahora.");
    expect(html.match(/<ol /g)?.length).toBe(3);
    expect(html).toContain('src="/tmdb-logo.svg"');
  });

  it("says the worldwide list could not load, and the site lists are still there", async () => {
    const html = await render(
      "es",
      <TrendingPage {...props({ worldwide: { status: "unavailable" } })} />,
    );

    expect(html).toContain("No pudimos cargar la lista del mundo");
    expect(html).toContain("Más agregados");
    expect(html).not.toContain("tmdb-logo");
  });

  it("says there is no worldwide list for books and manga", async () => {
    const html = await render(
      "en",
      <TrendingPage
        {...props({
          view: { type: "book", period: "week" },
          worldwide: { status: "unsupported" },
        })}
      />,
    );

    expect(html).toContain(
      "There is no worldwide list for this type of title.",
    );
    expect(html).not.toContain("tmdb-logo");
  });

  it("writes a title as text, never as markup", async () => {
    const html = await render(
      "es",
      <TrendingPage
        {...props({
          site: {
            ...nothing,
            mostAdded: [card('<script>alert("x")</script>')],
          },
        })}
      />,
    );

    expect(html).not.toContain("<script>alert");
  });
});
