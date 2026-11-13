import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminStatsContent from "./admin.stats.content";
import { resources } from "~/locales";

// The loader is tested in admin.stats.content.test.ts and the query on a real database; here only
// the page is drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/admin-content", () => ({}));
vi.mock("~server/db/admin-traffic", () => ({}));
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

const content = (fields: Record<string, unknown> = {}) => ({
  days: 30,
  from: "2026-10-13",
  to: "2026-11-11",
  searches: [
    { type: "anime", searches: 90 },
    { type: "movie", searches: 60 },
    { type: "weird", searches: 1 },
  ],
  customTotal: 12,
  customNew: 3,
  sagasPublished: 8,
  sagasDraft: 2,
  sagasEmpty: 1,
  works: 40,
  worksDescribed: 30,
  ...fields,
});

const props = (fields: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Contenido",
      publishableKey: "pk_test_x",
      content: content(fields),
      options: [7, 30, 90],
    },
  }) as unknown as Parameters<typeof AdminStatsContent>[0];

describe("the content page of the administration (SAG-26)", () => {
  it("shows the tiles and names the types searched, and a type with no name as it is", async () => {
    const html = await render(<AdminStatsContent {...props()} />);

    expect(html).toMatch(/<dt [^>]*>Búsquedas<\/dt><dd [^>]*>151</);
    expect(html).toMatch(/<dt [^>]*>Sagas publicadas<\/dt><dd [^>]*>8</);
    expect(html).toContain("Anime");
    expect(html).toContain("Películas");
    expect(html).toContain("weird");
  });

  it("says what is not measured: searches with no result", async () => {
    const html = await render(<AdminStatsContent {...props()} />);

    expect(html).toContain("Las búsquedas sin resultado todavía no se miden");
  });

  it("says the titles written by hand and how much of the sagas is filled in", async () => {
    const html = await render(<AdminStatsContent {...props()} />);

    expect(html).toContain("12 en total, 3 creados en el periodo.");
    expect(html).toMatch(/Obras con detalles: 75\s%\./);
    expect(html).toContain("Publicadas sin ninguna obra");
  });

  it("has no share and no searches when there is nothing, and no NaN", async () => {
    const html = await render(
      <AdminStatsContent
        {...props({ searches: [], works: 0, worksDescribed: 0 })}
      />,
    );

    expect(html).toContain("Todavía no hay datos en este periodo.");
    expect(html).not.toContain("Obras con detalles:");
    expect(html).not.toContain("NaN");
  });

  it("offers the three windows and has the content tab as the current section", async () => {
    const html = await render(<AdminStatsContent {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/content\?days=30"[^>]*aria-current="page"/,
    );
    expect(html).toMatch(/href="\/admin\/stats\/content\?days=7"/);
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/stats\/content"[^>]*aria-current="page"[^>]*>Contenido/,
    );
  });

  it("is written in English too", async () => {
    const html = await render(<AdminStatsContent {...props()} />, "en");

    expect(html).toContain("What people search for");
    expect(html).toContain("Coverage of the sagas");
    expect(html).toContain("Searches with no result are not measured yet");
  });
});
