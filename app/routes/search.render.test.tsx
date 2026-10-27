import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Search from "./search";
import { resources } from "~/locales";

// The loader is tested in search.test.ts; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/db/search-local", () => ({}));
vi.mock("~server/search/pipeline", () => ({}));

async function render(element: ReactNode): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: "es",
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

const result = (overrides: Record<string, unknown>) => ({
  id: null,
  provider: "tmdb",
  externalId: "movie/157336",
  type: "movie",
  title: "Interestelar",
  originalTitle: "Interstellar",
  year: 2014,
  synopsis: null,
  imageUrl: null,
  popularity: 1,
  source: "provider",
  poster: null,
  href: "/media/open?provider=tmdb&id=movie%2F157336",
  wholePage: true,
  ...overrides,
});

const props = (results: Record<string, unknown>[]) =>
  ({
    loaderData: {
      title: "Buscar",
      q: "inter",
      type: undefined,
      status: "done",
      results,
      failed: [],
    },
  }) as unknown as Parameters<typeof Search>[0];

describe("the links of the search results", () => {
  it("opens a title that is not saved yet with a whole-page navigation", async () => {
    const html = await render(<Search {...props([result({})])} />);

    // A link that moves inside the page carries `data-discover`; this one must not, because the
    // address it goes to has no page of its own: it saves the title and redirects.
    const link = /<a [^>]*href="\/media\/open[^"]*"[^>]*>/.exec(html)?.[0];
    expect(link).toBeDefined();
    expect(link).not.toContain("data-discover");
  });

  it("opens a title we already hold with a move inside the page", async () => {
    const html = await render(
      <Search
        {...props([
          result({
            id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
            href: "/media/movie/interestelar-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
            wholePage: false,
          }),
        ])}
      />,
    );

    const link = /<a [^>]*href="\/media\/movie\/interestelar[^"]*"[^>]*>/.exec(
      html,
    )?.[0];
    expect(link).toContain("data-discover");
  });
});
