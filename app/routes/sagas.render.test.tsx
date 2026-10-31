import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import SagaPage from "./sagas.$slug";
import { resources } from "~/locales";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/sagas", () => ({}));

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

const props = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      slug: "attack-on-titan",
      title: "Ataque a los Titanes",
      pageTitle: "Ataque a los Titanes | SagaShelf",
      description: "",
      canonicalUrl: "https://sagashelf.app/sagas/attack-on-titan",
      count: 3,
      order: "release",
      canChooseOrder: false,
      groups: [
        {
          format: "anime",
          items: [
            {
              qid: "Q2",
              label: "Attack on Titan",
              year: 2013,
              href: "/media/anime/attack-on-titan-1",
              entry: { status: "in_progress", percent: 40 },
            },
          ],
        },
        {
          format: "manga",
          items: [
            {
              qid: "Q1",
              label: "Shingeki no Kyojin",
              year: 2009,
              href: null,
              entry: null,
            },
          ],
        },
      ],
      signedIn: false,
      signInPath: "/sign-in?redirectTo=%2Fsagas%2Fattack-on-titan",
      totals: { inCatalog: 1, completed: 0, percent: 0 },
      hint: null,
      ...extra,
    },
  }) as unknown as Parameters<typeof SagaPage>[0];

describe("the saga page (SAG-25)", () => {
  it("names the saga and its works, with a link only for what the catalog holds", async () => {
    const html = await render("es", <SagaPage {...props()} />);

    expect(html).toContain("<h1");
    expect(html).toContain("Ataque a los Titanes");
    expect(html).toContain("3 obras en todos sus formatos");
    expect(html).toContain(">Anime<");
    expect(html).toContain(">Manga<");
    expect(html).toMatch(
      /<a [^>]*href="\/media\/anime\/attack-on-titan-1"[^>]*>Attack on Titan<\/a>/,
    );
    expect(html).toContain("Shingeki no Kyojin");
    expect(html).not.toMatch(/<a [^>]*>Shingeki no Kyojin<\/a>/);
    expect(html).toContain("(2013)");
  });

  it("sends a visitor to sign in instead of showing a progress that is not theirs", async () => {
    const html = await render("es", <SagaPage {...props()} />);

    expect(html).toContain("Inicia sesión para ver tu progreso en esta saga");
    expect(html).toContain(
      'href="/sign-in?redirectTo=%2Fsagas%2Fattack-on-titan"',
    );
    expect(html).not.toContain("<progress");
  });

  it("shows the progress of a signed-in person, with a native bar and the entry of each work", async () => {
    const html = await render(
      "es",
      <SagaPage
        {...props({
          signedIn: true,
          signInPath: null,
          totals: { inCatalog: 2, completed: 1, percent: 60 },
        })}
      />,
    );

    expect(html).toMatch(/<progress [^>]*value="60"[^>]*max="100"/);
    expect(html).toContain('aria-label="Progreso en la saga"');
    expect(html).toContain("60 % · 1 de 2 obras completadas");
    expect(html).toContain("En curso · 40 %");
    expect(html).not.toContain("Inicia sesión para ver tu progreso");
  });

  it("says there is nothing yet when the person holds no work of the saga", async () => {
    const html = await render(
      "en",
      <SagaPage
        {...props({
          signedIn: true,
          signInPath: null,
          totals: { inCatalog: 1, completed: 0, percent: 0 },
        })}
      />,
    );

    expect(html).toContain(
      "You have no works of this saga in your library yet.",
    );
    expect(html).not.toContain("<progress");
  });

  it("shows where to start, as a link when the catalog holds the work", async () => {
    const withLink = await render(
      "es",
      <SagaPage
        {...props({
          hint: {
            kind: "start",
            label: "Attack on Titan",
            href: "/media/anime/attack-on-titan-1",
          },
        })}
      />,
    );
    const withoutLink = await render(
      "en",
      <SagaPage
        {...props({
          hint: { kind: "next", label: "Shingeki no Kyojin", href: null },
        })}
      />,
    );

    expect(withLink).toContain("Por dónde empezar:");
    expect(withLink).toMatch(
      /<a [^>]*href="\/media\/anime\/attack-on-titan-1"[^>]*>Attack on Titan<\/a>/,
    );
    expect(withoutLink).toContain("Keep going with:");
    expect(withoutLink).not.toMatch(/<a [^>]*>Shingeki no Kyojin<\/a>/);
  });

  it("offers the two orders only when there are two, and marks the one in use", async () => {
    const none = await render("es", <SagaPage {...props()} />);
    const two = await render(
      "es",
      <SagaPage {...props({ canChooseOrder: true, order: "story" })} />,
    );

    expect(none).not.toContain("Orden de estreno");
    expect(two).toContain('aria-label="Orden"');
    expect(two).toContain("Orden de estreno");
    expect(two).toMatch(
      /<a [^>]*aria-current="page"[^>]*>Orden de la historia<\/a>/,
    );
  });

  it("names Wikidata as the source of the relations, with a link", async () => {
    const html = await render("en", <SagaPage {...props()} />);

    expect(html).toMatch(
      /<a [^>]*href="https:\/\/www.wikidata.org\/"[^>]*>Wikidata<\/a>/,
    );
  });
});
