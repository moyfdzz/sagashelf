import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import SagasPage from "./sagas";
import { resources } from "~/locales";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
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

const props = (loaderData: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      q: "",
      pageTitle: "Sagas | SagaShelf",
      description: "",
      canonicalUrl: "https://sagashelf.app/sagas",
      sagas: [
        {
          slug: "attack-on-titan",
          title: "Ataque a los Titanes",
          works: 13,
          formats: ["anime", "manga"],
        },
        { slug: "berserk", title: "Berserk", works: 1, formats: ["manga"] },
      ],
      ...loaderData,
    },
  }) as unknown as Parameters<typeof SagasPage>[0];

describe("the list of sagas (SAG-245)", () => {
  it("has one heading, a search form that works without JavaScript, and a card per saga", async () => {
    const html = await render("es", <SagasPage {...props()} />);

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">Sagas<");
    expect(html).toMatch(/<form [^>]*action="\/sagas"[^>]*method="get"/);
    expect(html).toContain('role="search"');
    expect(html).toMatch(/<label [^>]*for="sagas-q"/);
    expect(html).toMatch(/<input [^>]*name="q"/);
    expect(html).toContain('href="/sagas/attack-on-titan"');
    expect(html).toContain('href="/sagas/berserk"');
    expect(html).toContain("13 obras · Anime, Manga");
    expect(html).toContain("1 obra · Manga");
    expect(html).toContain("2 sagas");
  });

  it("is drawn in English too", async () => {
    const html = await render("en", <SagasPage {...props()} />);

    expect(html).toContain("Search for a saga");
    expect(html).toContain("13 works · Anime, Manga");
  });

  it("keeps what was searched in the field and says how many sagas matched", async () => {
    const html = await render(
      "es",
      <SagasPage
        {...props({
          q: "tita",
          sagas: [
            {
              slug: "attack-on-titan",
              title: "Ataque a los Titanes",
              works: 13,
              formats: ["anime", "manga"],
            },
          ],
        })}
      />,
    );

    expect(html).toMatch(/<input [^>]*value="tita"/);
    expect(html).toContain("1 saga para «tita»");
  });

  it("says nothing was found and offers the whole list, when a search has no result", async () => {
    const html = await render(
      "es",
      <SagasPage {...props({ q: "zzz", sagas: [] })} />,
    );

    expect(html).toContain("No encontramos ninguna saga con ese nombre.");
    expect(html).toContain('href="/sagas"');
    expect(html).toContain("0 sagas para «zzz»");
    expect(html).not.toContain("<ul");
  });

  it("says there is none yet, with no link to the list, when nothing is published", async () => {
    const html = await render("es", <SagasPage {...props({ sagas: [] })} />);

    expect(html).toContain("Todavía no hay sagas publicadas.");
    expect(html).not.toContain("Ver todas las sagas");
  });

  it("writes what was searched as text, never as markup", async () => {
    const html = await render(
      "es",
      <SagasPage {...props({ q: '<script>alert("x")</script>', sagas: [] })} />,
    );

    expect(html).not.toContain("<script>alert");
  });
});
