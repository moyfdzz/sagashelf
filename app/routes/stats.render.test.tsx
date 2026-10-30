import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Stats from "./stats";
import { resources } from "~/locales";
import type { Stats as StatsData } from "~server/db/stats";

// The loader is tested in stats.test.ts and the queries on a real database; here only the page is
// drawn.
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/stats", () => ({}));
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

const empty: StatsData = {
  entries: 0,
  completed: 0,
  episodesWatched: 0,
  rewatches: 0,
  minutesWatched: 0,
  minutesPlanned: 0,
  unknownRuntime: 0,
  pagesRead: 0,
  chaptersRead: 0,
  volumesRead: 0,
  averageScore: null,
  scored: 0,
  scores: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  byType: {},
  byStatus: {},
  releasedByYear: [],
  finishedByYear: [],
  finishedByMonth: [],
  undatedFinished: 0,
  best: [],
};

const full: StatsData = {
  ...empty,
  entries: 6,
  completed: 3,
  episodesWatched: 8,
  rewatches: 2,
  minutesWatched: 14_400,
  minutesPlanned: 2_880,
  unknownRuntime: 2,
  averageScore: 8.67,
  scored: 3,
  scores: [0, 0, 0, 0, 0, 0, 0, 2, 0, 1],
  byType: { movie: 3, series: 1, anime: 1, book: 1 },
  byStatus: { completed: 3, in_progress: 1, planned: 2 },
  releasedByYear: [
    { year: 2014, count: 2 },
    { year: 2020, count: 2 },
  ],
  finishedByYear: [
    { year: 2024, count: 1 },
    { year: 2025, count: 2 },
  ],
  finishedByMonth: [
    { year: 2024, month: 5, count: 1 },
    { year: 2025, month: 3, count: 2 },
  ],
  undatedFinished: 2,
  best: [
    {
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
      title: "Ataque a los Titanes",
      type: "anime",
      year: 2013,
      score: 10,
    },
  ],
};

const props = (stats: StatsData) =>
  ({
    loaderData: { title: "Estadísticas", stats },
  }) as unknown as Parameters<typeof Stats>[0];

describe("the statistics page", () => {
  it("says there is nothing to count, and where to find titles, for a library with nothing", async () => {
    const html = await render(<Stats {...props(empty)} />);

    expect(html).toContain("Aún no tienes títulos en tu biblioteca");
    expect(html).toMatch(/<a [^>]*href="\/search"/);
    expect(html).not.toContain("<svg");
  });

  it("writes the big numbers, the days with one decimal", async () => {
    const html = await render(<Stats {...props(full)} />);

    // 14 400 minutes are 10 days and 2 880 are 2.
    expect(html).toMatch(/>10<\/dd><dt[^>]*>Días de contenido visto/);
    expect(html).toMatch(/>2<\/dd><dt[^>]*>Días de contenido pendiente/);
    expect(html).toMatch(/>3<\/dd><dt[^>]*>Títulos completados/);
    expect(html).toMatch(/>8<\/dd><dt[^>]*>Episodios vistos/);
    expect(html).toMatch(/>8,7<\/dd><dt[^>]*>Puntuación promedio/);
  });

  it("says the days are approximate and how many titles are left out", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Los días son aproximados");
    expect(html).toContain("2 títulos aún no tienen duración");
    expect(
      await render(<Stats {...props({ ...full, unknownRuntime: 1 })} />),
    ).toContain("1 título aún no tiene duración");
    expect(
      await render(<Stats {...props({ ...full, unknownRuntime: 0 })} />),
    ).not.toContain("aún no tiene");
  });

  it("writes a dash, not a zero, for days when everything that counts has no length", async () => {
    const html = await render(
      <Stats {...props({ ...full, minutesWatched: 0, minutesPlanned: 0 })} />,
    );

    expect(html).toMatch(/>—<\/dd><dt[^>]*>Días de contenido visto/);
  });

  it("writes a zero for days when nothing was watched and nothing lacks a length", async () => {
    const html = await render(
      <Stats
        {...props({
          ...full,
          minutesWatched: 0,
          minutesPlanned: 0,
          unknownRuntime: 0,
        })}
      />,
    );

    expect(html).toMatch(/>0<\/dd><dt[^>]*>Días de contenido visto/);
  });

  it("shows the pages, chapters and volumes read only when there are some", async () => {
    const without = await render(<Stats {...props(full)} />);
    const withPages = await render(
      <Stats {...props({ ...full, pagesRead: 1200, volumesRead: 3 })} />,
    );

    expect(without).not.toContain("Páginas leídas");
    expect(withPages).toContain("Páginas leídas");
    expect(withPages).toContain("Volúmenes leídos");
    expect(withPages).not.toContain("Capítulos leídos");
  });

  it("links each score with something in it to the library with that exact score", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain('href="/library?rated=8"');
    expect(html).toContain('href="/library?rated=10"');
    expect(html).not.toContain('href="/library?rated=9"');
    expect(html).toContain("Promedio de 8,7 en 3 títulos puntuados.");
  });

  it("gives each chart the same numbers in a table", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html.match(/<details/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("Ver los números");
    expect(html).toContain("<title>8: 2 títulos</title>");
  });

  it("links the years of release to the library, and not the years finished", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain('href="/library?year=2014"');
    expect(html).toContain('href="/library?year=2020"');
    expect(html).not.toContain('href="/library?year=2025"');
  });

  it("says how many finished viewings have no date", async () => {
    expect(await render(<Stats {...props(full)} />)).toContain(
      "2 veces que terminaste algo no tienen fecha",
    );
    expect(
      await render(<Stats {...props({ ...full, undatedFinished: 0 })} />),
    ).not.toContain("no tienen fecha");
  });

  it("writes each type and status with its number", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Películas");
    expect(html).toMatch(/3 · 50\s%/);
    expect(html).toContain("En curso");
    expect(html).toContain("Abandonado");
  });

  it("lists the best scored with a link to each entry of the library", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain(
      'href="/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"',
    );
    expect(html).toContain("Ataque a los Titanes");
    expect(html).toContain("Anime · 2013");
    expect(html).toContain("10/10");
  });

  it("leaves out the charts of what there is none of", async () => {
    const html = await render(
      <Stats
        {...props({
          ...empty,
          entries: 1,
          byType: { movie: 1 },
          byStatus: { planned: 1 },
        })}
      />,
    );

    expect(html).toContain("Aún no has puntuado ningún título.");
    expect(html).toContain("Aún no hay fechas de término.");
    expect(html).not.toContain("Mejor puntuados");
    expect(html).not.toContain("Actividad por mes");
    expect(html).not.toContain("Por año de estreno");
    expect(html).not.toContain("NaN");
  });

  it("puts a title of a type we do not know in Others", async () => {
    const html = await render(
      <Stats {...props({ ...full, byType: { ...full.byType, custom: 4 } })} />,
    );

    expect(html).toContain("Otros");
  });

  it("says it in English", async () => {
    const html = await render(<Stats {...props(full)} />, "en");

    expect(html).toContain("Statistics");
    expect(html).toContain("Days of content watched");
    expect(html).toContain("Average of 8.7 over 3 scored titles.");
    expect(html).toContain("Show the numbers");
    expect(html).toContain("<title>8: 2 titles</title>");
  });
});
