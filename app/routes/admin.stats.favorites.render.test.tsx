import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminStatsFavorites from "./admin.stats.favorites";
import { resources } from "~/locales";

// The loader is tested in admin.stats.favorites.test.ts; here only the page is drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/trending/page", () => ({}));
vi.mock("~server/trending/query", () => ({}));
vi.mock("~server/db/site-favorites", () => ({}));
vi.mock("~server/media/slug", () => ({}));
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

const row = (key: string, title: string, people: number, average = null) => ({
  key,
  href: `/media/${key}`,
  title,
  people,
  average: average as number | null,
});

const props = (fields: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Favoritos",
      publishableKey: "pk_test_x",
      view: { type: "movie", period: "week" },
      pastYears: [2026],
      minPeople: 3,
      site: {
        mostAdded: [row("a", "Dune", 9), row("b", "Alien", 4)],
        mostCompleted: [],
        bestRated: [row("c", "Heat", 5, 8.46 as never)],
      },
      worldwide: {
        status: "ok",
        source: "TMDB",
        titles: [
          { key: "tmdb:1", title: "Oppenheimer", year: 2023 },
          { key: "tmdb:2", title: "Sin año", year: null },
        ],
      },
      ...fields,
    },
  }) as unknown as Parameters<typeof AdminStatsFavorites>[0];

describe("the favorites page of the administration (SAG-26)", () => {
  it("lists the titles of the site, each one a link, with how many people stand behind it", async () => {
    const html = await render(<AdminStatsFavorites {...props()} />);

    expect(html).toMatch(/<a [^>]*href="\/media\/a"/);
    expect(html).toContain("Dune");
    expect(html).toContain("9 personas");
    expect(html).toContain("Más agregados");
    expect(html).toContain("Mejor calificados");
  });

  it("writes the average of a rated title next to its name", async () => {
    const html = await render(<AdminStatsFavorites {...props()} />);

    expect(html).toContain("Heat · 8,5");
  });

  it("says a list is empty, with the minimum of people", async () => {
    const html = await render(<AdminStatsFavorites {...props()} />);

    expect(html).toContain("Ningún título llega todavía a 3 personas");
  });

  it("lists what the world watches, with the year when there is one, and no links", async () => {
    const html = await render(<AdminStatsFavorites {...props()} />);

    expect(html).toContain("Oppenheimer");
    expect(html).toContain("(2023)");
    expect(html).toContain("Sin año");
    expect(html).not.toContain("(null)");
    expect(html).toContain("TMDB");
  });

  it("says the list of the world is not available or not supported", async () => {
    const unavailable = await render(
      <AdminStatsFavorites
        {...props({ worldwide: { status: "unavailable" } })}
      />,
    );
    const unsupported = await render(
      <AdminStatsFavorites
        {...props({ worldwide: { status: "unsupported" } })}
      />,
    );

    expect(unavailable).toContain("No pudimos cargar la lista del mundo");
    expect(unsupported).toContain("No hay una lista del mundo");
  });

  it("offers every type and period as a link, and marks the current ones", async () => {
    const html = await render(<AdminStatsFavorites {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/favorites"[^>]*aria-current="page"[^>]*>Películas/,
    );
    expect(html).toMatch(/href="\/admin\/stats\/favorites\?type=manga"/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/favorites"[^>]*aria-current="page"[^>]*>Última semana/,
    );
    expect(html).toMatch(
      /href="\/admin\/stats\/favorites\?period=2026"[^>]*>2026</,
    );
  });

  it("is written in English too", async () => {
    const html = await render(<AdminStatsFavorites {...props()} />, "en");

    expect(html).toContain("Most added");
    expect(html).toContain("Best rated");
    expect(html).toContain("9 people");
  });
});
