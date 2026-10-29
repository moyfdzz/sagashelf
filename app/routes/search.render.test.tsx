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

/** The page while the form of a result is on its way to the server and has no answer. */
async function renderSending(
  element: ReactNode,
  action: string,
  key: string,
): Promise<string> {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    resources,
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
  const router = createMemoryRouter(
    [
      { path: "/", element },
      {
        id: "sent",
        path: "/library/*",
        action: () => new Promise(() => undefined),
      },
    ],
    { initialEntries: ["/"] },
  );
  void router.fetch(key, "sent", action, {
    formMethod: "post",
    formData: new FormData(),
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
  libraryStatus: null,
  ...overrides,
});

const props = (results: Record<string, unknown>[], signedIn = false) =>
  ({
    loaderData: {
      title: "Buscar",
      q: "inter",
      type: undefined,
      tabs: ["anime", "movie", "series"],
      status: "done",
      signedIn,
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

  it("shows the authors of a book, and nothing when there are none", async () => {
    const withAuthors = await render(
      <Search
        {...props([result({ creators: ["Frank Herbert", "Brian Herbert"] })])}
      />,
    );
    const without = await render(
      <Search {...props([result({ creators: [] })])} />,
    );

    expect(withAuthors).toContain("Frank Herbert, Brian Herbert");
    expect(without).not.toContain("Frank Herbert");
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

describe("adding a result to the library", () => {
  const held = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
  const heldResult = (overrides: Record<string, unknown> = {}) =>
    result({
      id: held,
      href: `/media/movie/interestelar-${held}`,
      wholePage: false,
      ...overrides,
    });
  const forms = (html: string) =>
    html.match(/<form[^>]*>[\s\S]*?<\/form>/g) ?? [];

  it("gives a visitor no button and no status", async () => {
    const html = await render(
      <Search
        {...props([result({}), heldResult({ libraryStatus: "planned" })])}
      />,
    );

    expect(forms(html)).toHaveLength(1); // the search box only
    expect(html).not.toContain("Añadir");
    expect(html).not.toContain("En tu biblioteca");
  });

  it("gives a title that only a provider knows a form that saves it and adds it", async () => {
    const html = await render(<Search {...props([result({})], true)} />);

    const form =
      forms(html).find((form) => form.includes("add-external")) ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/library/add-external"');
    expect(form).toContain('name="provider" value="tmdb"');
    expect(form).toContain('name="id" value="movie/157336"');
    expect(form).toContain(">Añadir<");
    expect(form).toContain('aria-label="Añadir Interestelar a mi biblioteca"');
    expect(form).not.toContain("mediaId");
  });

  it("gives a title we hold, that the person does not, the plain add", async () => {
    const html = await render(<Search {...props([heldResult()], true)} />);

    const form =
      forms(html).find((form) => form.includes('action="/library/add"')) ?? "";
    expect(form).toContain(`name="mediaId" value="${held}"`);
    expect(form).not.toContain("add-external");
  });

  it("says the status of a title the person already has, with no form to add it again", async () => {
    const html = await render(
      <Search {...props([heldResult({ libraryStatus: "completed" })], true)} />,
    );

    expect(html).toContain("En tu biblioteca: Completado");
    expect(forms(html).some((form) => form.includes("/library/add"))).toBe(
      false,
    );
  });

  it("says it in English", async () => {
    const html = await render(
      <Search
        {...props(
          [
            result({}),
            heldResult({ libraryStatus: "in_progress", externalId: "movie/9" }),
          ],
          true,
        )}
      />,
      "en",
    );

    expect(html).toContain("In your library: In progress");
    expect(html).toContain(">Add<");
    expect(html).toContain('aria-label="Add Interestelar to my library"');
  });

  it("gives each result its own form, so adding one does not touch the others", async () => {
    const html = await render(
      <Search
        {...props(
          [
            result({ externalId: "movie/1", title: "Uno" }),
            result({ externalId: "movie/2", title: "Dos" }),
          ],
          true,
        )}
      />,
    );

    expect(
      forms(html).filter((form) => form.includes("add-external")),
    ).toHaveLength(2);
    expect(html).toContain('value="movie/1"');
    expect(html).toContain('value="movie/2"');
  });
});

describe("a result while it is being added", () => {
  const sending = (
    results: Record<string, unknown>[],
    action: string,
    key: string,
  ) => renderSending(<Search {...props(results, true)} />, action, key);

  it("says it is in the library at once, with no button to press twice", async () => {
    const html = await sending(
      [result({})],
      "/library/add-external",
      "add-tmdb:movie/157336",
    );

    expect(html).toContain("En tu biblioteca: Pendiente");
    expect(html).not.toContain(">Añadir<");
  });

  it("changes only the result that was added", async () => {
    const html = await sending(
      [
        result({ externalId: "movie/1", title: "Uno" }),
        result({ externalId: "movie/2", title: "Dos" }),
      ],
      "/library/add-external",
      "add-tmdb:movie/1",
    );

    expect(html.match(/En tu biblioteca: Pendiente/g)).toHaveLength(1);
    expect(html.match(/>Añadir</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Añadir Dos a mi biblioteca"');
  });
});
