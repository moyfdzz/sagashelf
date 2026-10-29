import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import MediaDetail from "./media.$type.$slug";
import { resources } from "~/locales";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/library", () => ({}));
vi.mock("~server/db/media-detail", () => ({}));
vi.mock("~server/media/import", () => ({}));

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

const props = (backToSearch: string | null) =>
  ({
    loaderData: {
      id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
      backToSearch,
      library: {
        signedIn: false,
        status: null,
        signInPath: "/sign-in?redirectTo=%2F",
      },
      type: "series",
      title: "The Pitt",
      pageTitle: "The Pitt | SagaShelf",
      originalTitle: null,
      creators: [],
      year: 2025,
      status: "ongoing",
      synopsis: null,
      synopsisLocale: "es",
      description: "",
      poster: null,
      seasons: [],
      source: null,
      canonicalUrl: "https://sagashelf.app/media/series/the-pitt-1",
      shareImageUrl: null,
      jsonLd: {},
    },
  }) as unknown as Parameters<typeof MediaDetail>[0];

describe("the link back to the search on a title page", () => {
  it("is the first thing on the page when the person came from the search", async () => {
    const html = await render(
      "es",
      <MediaDetail {...props("/search?q=the+pitt&type=series")} />,
    );

    const link =
      /<a [^>]*href="\/search\?q=the\+pitt&amp;type=series"[^>]*>/.exec(
        html,
      )?.[0];
    expect(link).toBeTruthy();
    expect(html).toContain("← Volver a los resultados");
    // Before the title, so it is the first thing a person or a screen reader meets.
    expect(html.indexOf("Volver a los resultados")).toBeLessThan(
      html.indexOf("The Pitt"),
    );
  });

  it("is in English when the site is in English", async () => {
    const html = await render(
      "en",
      <MediaDetail {...props("/search?q=the+pitt")} />,
    );

    expect(html).toContain("← Back to the results");
    expect(html).not.toContain("Volver a los resultados");
  });

  it("is not there when the person did not come from the search", async () => {
    const html = await render("es", <MediaDetail {...props(null)} />);

    expect(html).not.toContain("Volver a los resultados");
    expect(html).not.toContain('href="/search');
  });
});
