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
  minutesByType: {},
  scoreByType: {},
  mostWatched: [],
  mostRewatched: [],
  finishTime: { medianDays: null, counted: 0, skipped: 0 },
  oldestPlanned: [],
  byGenre: [],
  withoutGenre: 0,
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
  minutesByType: { movie: 2_880, series: 11_520 },
  scoreByType: {
    movie: { average: 8, scored: 2 },
    anime: { average: 9.5, scored: 1 },
  },
  mostWatched: [
    {
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa",
      title: "Los siete samuráis",
      type: "movie",
      year: 1954,
      minutes: 600,
    },
    {
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-bbbbbbbbbbbb",
      title: "Cowboy Bebop",
      type: "anime",
      year: 1998,
      minutes: 90,
    },
  ],
  mostRewatched: [
    {
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-cccccccccccc",
      title: "Interestelar",
      type: "movie",
      year: 2014,
      rewatches: 2,
      minutes: 240,
    },
    {
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-dddddddddddd",
      title: "Dune",
      type: "book",
      year: 1965,
      rewatches: 1,
      minutes: 0,
    },
  ],
  finishTime: { medianDays: 9, counted: 2, skipped: 1 },
  oldestPlanned: [
    {
      mediaId: "0199a3c2-7d4e-7b1a-8c3f-eeeeeeeeeeee",
      title: "Akira",
      type: "movie",
      year: 1988,
      addedOn: "2025-01-15",
    },
  ],
  byGenre: [
    {
      genre: "action",
      titles: 4,
      minutes: 14_400,
      pagesRead: 0,
      chaptersRead: 0,
      volumesRead: 0,
      scored: 3,
      averageScore: 9,
    },
    {
      genre: "drama",
      titles: 3,
      minutes: 2_880,
      pagesRead: 0,
      chaptersRead: 0,
      volumesRead: 0,
      scored: 2,
      averageScore: 7.5,
    },
    {
      genre: "isekai",
      titles: 2,
      minutes: 0,
      pagesRead: 0,
      chaptersRead: 120,
      volumesRead: 0,
      scored: 1,
      averageScore: 10,
    },
    {
      genre: "biography",
      titles: 1,
      minutes: 0,
      pagesRead: 300,
      chaptersRead: 0,
      volumesRead: 0,
      scored: 0,
      averageScore: null,
    },
  ],
  withoutGenre: 2,
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
    ).not.toContain("aún no tiene duración");
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
    expect(html).not.toContain("Tiempo por tipo");
    expect(html).not.toContain("Puntuación por tipo");
    expect(html).not.toContain("Lo que más tiempo has visto");
    expect(html).not.toContain("Lo que más has repetido");
    expect(html).not.toContain("Tu ritmo");
    expect(html).not.toContain("Pendientes desde hace más tiempo");
  });

  it("puts a title of a type we do not know in Others", async () => {
    const html = await render(
      <Stats {...props({ ...full, byType: { ...full.byType, custom: 4 } })} />,
    );

    expect(html).toContain("Otros");
  });

  it("writes the days of each type, with its share, and leaves out the types with no time", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Tiempo por tipo");
    // 2 880 of 14 400 minutes are 2 of 10 days.
    expect(html).toMatch(/2 días · 20\s%/);
    expect(html).toMatch(/8 días · 80\s%/);
    expect(html).toContain("<title>Series: 8 días</title>");
    // Books have a place in the chart of types, but no days.
    expect(html).not.toMatch(/<title>Libros: [^<]*días/);
  });

  it("measures the score of each type out of 10 and writes how many titles it comes from", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Puntuación por tipo");
    expect(html).toContain("Películas · 2 títulos");
    expect(html).toContain("Anime · 1 título");
    expect(html).toContain(">9,5<");
    // 8 out of 10 of a 300 wide track.
    expect(html).toMatch(/<rect width="240"[^>]*class="fill-accent"/);
  });

  it("lists the titles with the most time, in hours, each linked to its entry", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Lo que más tiempo has visto");
    expect(html).toContain("Los siete samuráis (Películas · 1954)");
    expect(html).toContain(">10 h<");
    expect(html).toContain(">1,5 h<");
    expect(html).toContain(
      'href="/library/0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa"',
    );
  });

  it("lists what was watched again, with the extra hours only when there is a length", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Lo que más has repetido");
    expect(html).toContain("2 veces más · 4 h");
    expect(html).toContain(">1 vez más<");
    expect(html).toContain(
      'href="/library/0199a3c2-7d4e-7b1a-8c3f-cccccccccccc"',
    );
  });

  it("writes the best year, the best month and the median of days, and how many are left out", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Tu ritmo");
    expect(html).toMatch(
      />2025<\/dd><dt[^>]*>Tu mejor año, con 2 títulos terminados/,
    );
    expect(html).toMatch(
      />marzo 2025<\/dd><dt[^>]*>Tu mejor mes, con 2 títulos terminados/,
    );
    expect(html).toMatch(/>9<\/dd><dt[^>]*>Días que tardas en terminar algo/);
    expect(html).toContain(
      "1 vez que terminaste algo no tiene fecha de inicio",
    );
  });

  it("leaves out the median and the note when every finished viewing has both dates", async () => {
    const noSpan = await render(
      <Stats
        {...props({
          ...full,
          finishTime: { medianDays: null, counted: 0, skipped: 0 },
        })}
      />,
    );
    const allDated = await render(
      <Stats
        {...props({
          ...full,
          finishTime: { medianDays: 9, counted: 3, skipped: 0 },
        })}
      />,
    );

    expect(noSpan).not.toContain("Días que tardas");
    expect(allDated).not.toContain("no tiene fecha de inicio");
    expect(allDated).not.toContain("no tienen fecha de inicio");
  });

  it("lists the oldest planned with the day they were added", async () => {
    const html = await render(<Stats {...props(full)} />);

    expect(html).toContain("Pendientes desde hace más tiempo");
    expect(html).toContain("Akira");
    expect(html).toMatch(/15 ene 2025/);
  });

  describe("the links to the library (SAG-89)", () => {
    // The library has its own security policy (ADR-018), which only a new document gets, so every
    // link to it is a plain link. A link of the router carries `data-discover`.
    const toLibrary = (html: string) =>
      (html.match(/<a [^>]*>/g) ?? []).filter((tag) =>
        tag.includes('href="/library'),
      );

    it("are all plain links, whatever chart or list they are in", async () => {
      const html = await render(<Stats {...props(full)} />);
      const links = toLibrary(html);

      for (const tag of links) expect(tag, tag).not.toContain("data-discover");
      // Not an empty check: the bars, the three lists, the genres and the table all link.
      expect(links.length).toBeGreaterThanOrEqual(20);
    });

    it("include the bars of the scores and of the years of release", async () => {
      const links = toLibrary(await render(<Stats {...props(full)} />)).join(
        "\n",
      );

      expect(links).toContain('href="/library?rated=8"');
      expect(links).toContain('href="/library?year=2014"');
    });

    it("include the entry of each list: the best scored, the most time, what was watched again and the oldest planned", async () => {
      const links = toLibrary(await render(<Stats {...props(full)} />)).join(
        "\n",
      );

      for (const mediaId of [
        "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f", // best scored
        "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa", // most time
        "0199a3c2-7d4e-7b1a-8c3f-cccccccccccc", // watched again
        "0199a3c2-7d4e-7b1a-8c3f-eeeeeeeeeeee", // oldest planned
      ]) {
        expect(links).toContain(`href="/library/${mediaId}"`);
      }
    });

    it("leave the link to the search, which has no policy of its own, as a link of the router", async () => {
      const html = await render(<Stats {...props(empty)} />);

      expect(html).toMatch(/<a [^>]*href="\/search"[^>]*data-discover="true"/);
    });
  });

  describe("the genres (SAG-86)", () => {
    it("draws the time of each genre in days, with its titles, and leaves out the genres with no minutes", async () => {
      const html = await render(<Stats {...props(full)} />);

      expect(html).toContain("Tiempo por género");
      expect(html).toContain("Acción · 4 títulos");
      expect(html).toContain(">10 días<");
      expect(html).toContain("Drama · 3 títulos");
      expect(html).toContain(">2 días<");
      // Isekai and biography have chapters and pages, not minutes, so no bar of time.
      expect(html).not.toContain("Isekai · 2 títulos");
      expect(html).not.toContain("Biografía · 1 título");
    });

    it("draws the titles of each genre, books and manga included", async () => {
      const html = await render(<Stats {...props(full)} />);

      expect(html).toContain("Títulos por género");
      expect(html).toContain(">Isekai<");
      expect(html).toContain(">Biografía<");
    });

    it("links every genre of a chart to the library with that genre, as a plain link", async () => {
      const html = await render(<Stats {...props(full)} />);

      for (const genre of ["action", "drama", "isekai", "biography"]) {
        expect(html).toContain(`href="/library?genre=${genre}"`);
      }
      // A plain link, because the library has its own security policy: no client-side link.
      expect(html).not.toMatch(/data-discover[^>]*href="\/library\?genre=/);
    });

    it("ranks the best scored genres out of 10, and only the ones with two scored titles", async () => {
      const html = await render(<Stats {...props(full)} />);

      expect(html).toContain("Géneros mejor puntuados");
      expect(html).toContain("Acción · 3 títulos");
      expect(html).toContain("Drama · 2 títulos");
      // Isekai has one score of 10: not enough to say it is the best.
      expect(html).not.toContain("Isekai · 1 título");
      // 9 out of 10 of a 300 wide track.
      expect(html).toMatch(/<rect width="270"[^>]*class="fill-accent"/);
    });

    it("leaves out the best scored when no genre has two scored titles", async () => {
      const html = await render(
        <Stats
          {...props({
            ...full,
            byGenre: full.byGenre.map((entry) => ({
              ...entry,
              scored: Math.min(entry.scored, 1),
            })),
          })}
        />,
      );

      expect(html).not.toContain("Géneros mejor puntuados");
      expect(html).toContain("Tiempo por género");
    });

    it("writes every genre in a table with the titles, the days and the progress, and a dash for what has none", async () => {
      const html = await render(<Stats {...props(full)} />);

      expect(html).toContain("Todos tus géneros");
      for (const header of [
        "Género",
        "Días",
        "Páginas",
        "Capítulos",
        "Volúmenes",
        "Puntuación",
      ]) {
        expect(html).toContain(`>${header}</th>`);
      }
      expect(html).toContain(">300</td>");
      expect(html).toContain(">120</td>");
      expect(html).toContain(">7,5</td>");
      expect(html).toContain(">—</td>");
    });

    it("says how many titles have no genre, and says nothing when every title has one", async () => {
      expect(await render(<Stats {...props(full)} />)).toContain(
        "2 títulos aún no tienen género",
      );
      expect(
        await render(<Stats {...props({ ...full, withoutGenre: 1 })} />),
      ).toContain("1 título aún no tiene género");
      expect(
        await render(<Stats {...props({ ...full, withoutGenre: 0 })} />),
      ).not.toContain("aún no tienen género");
    });

    it("says the genres are still being filled when no title has one yet, and draws no chart of them", async () => {
      const html = await render(
        <Stats {...props({ ...full, byGenre: [], withoutGenre: 5 })} />,
      );

      expect(html).toContain("Tus títulos aún no tienen género");
      expect(html).toContain("5 títulos aún no tienen género");
      expect(html).not.toContain("Tiempo por género");
      expect(html).not.toContain("Todos tus géneros");
    });

    it("shows nothing about genres when there is nothing to say", async () => {
      const html = await render(
        <Stats {...props({ ...full, byGenre: [], withoutGenre: 0 })} />,
      );

      expect(html).not.toContain("Tiempo por género");
      expect(html).not.toContain("tienen género");
      expect(html).not.toContain("NaN");
    });

    it("says it in English", async () => {
      const html = await render(<Stats {...props(full)} />, "en");

      expect(html).toContain("Time by genre");
      expect(html).toContain("Action · 4 titles");
      expect(html).toContain("Best scored genres");
      expect(html).toContain("All your genres");
      expect(html).toContain("2 titles have no genre yet");
    });
  });

  it("says it in English", async () => {
    const html = await render(<Stats {...props(full)} />, "en");

    expect(html).toContain("Statistics");
    expect(html).toContain("Days of content watched");
    expect(html).toContain("Average of 8.7 over 3 scored titles.");
    expect(html).toContain("Show the numbers");
    expect(html).toContain("<title>8: 2 titles</title>");
    expect(html).toContain("Your pace");
    expect(html).toContain("Your best year, with 2 titles finished");
    expect(html).toContain("2 more times");
    expect(html).toContain("Jan 15, 2025");
  });
});
