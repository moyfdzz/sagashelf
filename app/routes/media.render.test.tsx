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
vi.mock("~server/db/wikidata-store", () => ({}));
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

const props = (
  backToSearch: string | null,
  backToEntry: string | null = null,
  extra: Record<string, unknown> = {},
) =>
  ({
    loaderData: {
      id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
      backToSearch,
      backToEntry,
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
      genres: [],
      year: 2025,
      status: "ongoing",
      synopsis: null,
      synopsisLocale: "es",
      description: "",
      poster: null,
      seasons: [],
      related: [],
      source: null,
      canonicalUrl: "https://sagashelf.app/media/series/the-pitt-1",
      shareImageUrl: null,
      jsonLd: {},
      ...extra,
    },
  }) as unknown as Parameters<typeof MediaDetail>[0];

describe("the genres on a title page (SAG-71)", () => {
  const withGenres = (genres: string[]) =>
    props(null, null, { genres }) as Parameters<typeof MediaDetail>[0];

  it("names each genre in the language of the site, in a list that says what it is", async () => {
    const es = await render(
      "es",
      <MediaDetail {...withGenres(["action", "sci_fi", "isekai"])} />,
    );
    const en = await render(
      "en",
      <MediaDetail {...withGenres(["action", "sci_fi", "isekai"])} />,
    );

    expect(es).toContain('aria-label="Géneros"');
    expect(es).toContain(">Acción<");
    expect(es).toContain(">Ciencia ficción<");
    expect(es).toContain(">Isekai<");
    expect(en).toContain('aria-label="Genres"');
    expect(en).toContain(">Sci-Fi<");
  });

  it("keeps the order the genres were saved in, and puts them before the synopsis", async () => {
    const html = await render(
      "es",
      <MediaDetail {...withGenres(["drama", "action"])} />,
    );

    expect(html.indexOf(">Drama<")).toBeLessThan(html.indexOf(">Acción<"));
    expect(html.indexOf(">Acción<")).toBeLessThan(html.indexOf("Sinopsis"));
  });

  it("leaves the genres as labels for a visitor, who has no library to filter (SAG-86)", async () => {
    const html = await render(
      "es",
      <MediaDetail {...withGenres(["action"])} />,
    );

    expect(html).not.toMatch(/<a [^>]*>Acción<\/a>/);
    expect(html).not.toContain("/library?genre=");
  });

  it("links each genre to the library filtered by it for a signed-in person, as a plain link (SAG-86)", async () => {
    const signedIn = props(null, null, {
      genres: ["action", "sci_fi"],
      library: { signedIn: true, status: null },
    }) as Parameters<typeof MediaDetail>[0];

    const html = await render("es", <MediaDetail {...signedIn} />);

    expect(html).toMatch(
      /<a [^>]*href="\/library\?genre=action"[^>]*>Acción<\/a>/,
    );
    expect(html).toMatch(
      /<a [^>]*href="\/library\?genre=sci_fi"[^>]*>Ciencia ficción<\/a>/,
    );
  });

  it("shows no list when the title has no genre, so there is no empty box", async () => {
    const html = await render("es", <MediaDetail {...withGenres([])} />);

    expect(html).not.toContain('aria-label="Géneros"');
  });
});

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

describe("the link back to the entry on a title page", () => {
  const entry = "/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

  it("is the first thing on the page, as a plain link because the entry has its own policy", async () => {
    const html = await render("es", <MediaDetail {...props(null, entry)} />);

    expect(html).toContain("← Volver a mi entrada");
    expect(html).toContain(`href="${entry}"`);
    expect(html.indexOf("Volver a mi entrada")).toBeLessThan(
      html.indexOf("The Pitt"),
    );
    // A whole-page link: the router does not take it over (the credits link below it does).
    const tag = new RegExp(`<a [^>]*href="${entry}"[^>]*>`).exec(html)?.[0];
    expect(tag).toBeTruthy();
    expect(tag).not.toContain("data-discover");
  });

  it("is in English when the site is in English", async () => {
    const html = await render("en", <MediaDetail {...props(null, entry)} />);

    expect(html).toContain("← Back to my entry");
  });

  it("is the only link when the person came from an entry, and not there otherwise", async () => {
    const fromEntry = await render(
      "es",
      <MediaDetail {...props(null, entry)} />,
    );
    const nowhere = await render("es", <MediaDetail {...props(null, null)} />);

    expect(fromEntry).not.toContain("Volver a los resultados");
    expect(nowhere).not.toContain("Volver a mi entrada");
  });
});

describe("the look of the links on a title page", () => {
  const tagOf = (html: string, text: string) =>
    new RegExp(`<a [^>]*>${text}</a>`).exec(html)?.[0] ?? "";
  const page = (extra: Record<string, unknown>) =>
    render("es", <MediaDetail {...props(null, null, extra)} />);

  it("gives the link to the source the shared look and an arrow that leaves the site", async () => {
    const html = await page({
      source: {
        name: "tmdb",
        label: "TMDB",
        url: "https://www.themoviedb.org/tv/1",
      },
    });

    const link = tagOf(html, "Ver en TMDB");
    expect(link).toContain("hover:text-link-hover");
    expect(link).toContain("↗");
    // A link on its own has no underline.
    expect(link).not.toMatch(/(^| )underline( |")/);
  });

  it("gives the link to the entry the shared look and an arrow that goes on", async () => {
    const html = await page({
      library: { signedIn: true, status: "planned", signInPath: "/sign-in" },
    });

    const link = tagOf(html, "Editar mi entrada");
    expect(link).toContain("hover:text-link-hover");
    expect(link).toContain("→");
    expect(link).not.toContain("↗");
  });

  it("gives the sign in link the shared look, with no arrow", async () => {
    const html = await page({});

    const link = /<a [^>]*href="\/sign-in[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain("hover:text-link-hover");
    expect(link).not.toMatch(/[→↗]/);
  });

  it("gives the link back the shared look, with the arrow in its text", async () => {
    const html = await render(
      "es",
      <MediaDetail {...props("/search?q=dune")} />,
    );

    const link = /<a [^>]*href="\/search\?q=dune"[^>]*>/.exec(html)?.[0] ?? "";
    expect(link).toContain("hover:text-link-hover");
    expect(html).toContain("← Volver a los resultados");
  });
});

describe("links inside a sentence and links on their own", () => {
  const classOf = (html: string, href: string) =>
    new RegExp(`<a [^>]*href="${href}"[^>]*class="([^"]*)"`).exec(html)?.[1] ??
    new RegExp(`<a [^>]*class="([^"]*)"[^>]*href="${href}"`).exec(html)?.[1] ??
    "";

  it("keeps a thin underline on the link to the credits, which is in a sentence", async () => {
    const html = await render("es", <MediaDetail {...props(null)} />);

    const credits = classOf(html, "/credits");
    expect(credits).toMatch(/(^| )underline( |$)/);
    expect(credits).toContain("underline-offset-4");
    expect(credits).toContain("hover:text-link-hover");
  });

  it("has no underline on the link back, which stands on its own", async () => {
    const html = await render(
      "es",
      <MediaDetail {...props("/search?q=dune")} />,
    );

    const back = classOf(html, "/search[?]q=dune");
    expect(back).toContain("hover:text-link-hover");
    expect(back).not.toMatch(/(^| )underline( |$)/);
  });
});

describe("the other formats of a story (SAG-16)", () => {
  const related = [
    {
      format: "movie",
      items: [
        {
          qid: "Q2",
          label: "Película Titán",
          href: "/media/movie/pelicula-titan-1",
        },
      ],
    },
    {
      format: "manga",
      items: [{ qid: "Q1", label: "Attack on Titan", href: null }],
    },
  ];
  const withRelated = (extra: unknown[]) =>
    props(null, null, { related: extra }) as Parameters<typeof MediaDetail>[0];

  it("lists each format under its heading, with a link only for what the catalog holds", async () => {
    const html = await render("es", <MediaDetail {...withRelated(related)} />);

    expect(html).toContain("Otros formatos de esta historia");
    expect(html).toContain(">Películas<");
    expect(html).toContain(">Manga<");
    expect(html).toMatch(
      /<a [^>]*href="\/media\/movie\/pelicula-titan-1"[^>]*>Película Titán<\/a>/,
    );
    expect(html).toContain("<li>Attack on Titan</li>");
    expect(html).not.toMatch(/<a [^>]*>Attack on Titan<\/a>/);
  });

  it("names Wikidata as the source, with a link", async () => {
    const html = await render("en", <MediaDetail {...withRelated(related)} />);

    expect(html).toContain("Other formats of this story");
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/www.wikidata.org\/"[^>]*>Wikidata<\/a>/,
    );
  });

  it("shows nothing when Wikidata knows no other format", async () => {
    const html = await render("es", <MediaDetail {...withRelated([])} />);

    expect(html).not.toContain("Otros formatos");
    expect(html).not.toContain("wikidata.org");
  });
});
