import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import AdminSaga from "./admin.sagas.$id";
import AdminSagas from "./admin.sagas";
import { resources } from "~/locales";

// The loaders and actions are tested in their own files; here only the pages are drawn.
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/auth/admin-write", () => ({}));
vi.mock("~server/db/sagas-admin", () => ({}));
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

const listProps = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Sagas",
      publishableKey: "pk_test_x",
      error: null,
      sagas: [
        {
          id: "id-draft",
          slug: "dune",
          title: "Dune",
          titles: { es: "Dune ES", en: "Dune" },
          status: "draft",
          origin: "wikidata",
          members: 5,
          described: 3,
        },
        {
          id: "id-pub",
          slug: "attack-on-titan",
          title: "Attack on Titan",
          titles: { es: "Ataque a los Titanes", en: "Attack on Titan" },
          status: "published",
          origin: "file",
          members: 13,
          described: 13,
        },
      ],
      ...extra,
    },
  }) as unknown as Parameters<typeof AdminSagas>[0];

describe("the list of sagas of the administration (SAG-92)", () => {
  it("lists each saga with its state, its origin and its works, each linking to its own page", async () => {
    const html = await render(<AdminSagas {...listProps()} />);

    expect(html).toContain("Ataque a los Titanes");
    expect(html).toContain("Dune ES");
    expect(html).toContain("Borrador");
    expect(html).toContain("Publicada");
    expect(html).toContain("Sugerida por Wikidata");
    expect(html).toContain("Del archivo");
    expect(html).toContain("13 obras");
    expect(html).toMatch(/<a [^>]*href="\/admin\/sagas\/id-draft"/);
    expect(html).toMatch(/<a [^>]*href="\/admin\/sagas\/id-pub"/);
  });

  it("says how many works are not described yet, and only when some are not", async () => {
    const html = await render(<AdminSagas {...listProps()} />);

    expect(html).toContain("3 de 5 descritas");
    expect(html).not.toContain("13 de 13");
  });

  it("names the sagas in English for an English page", async () => {
    const html = await render(<AdminSagas {...listProps()} />, "en");

    expect(html).toContain("Create a saga");
    expect(html).toContain("Draft");
    expect(html).toContain("3 of 5 described");
    expect(html).toContain("5 works");
  });

  it("has a form to create a draft, with the two names, that sends a POST", async () => {
    const html = await render(<AdminSagas {...listProps()} />);

    expect(html).toMatch(/<form [^>]*method="post"/);
    expect(html).toContain('name="intent" value="create"');
    expect(html).toContain('name="titleEs"');
    expect(html).toContain('name="titleEn"');
    expect(html).toContain("Crear borrador");
  });

  it("says why the last change did not happen", async () => {
    const html = await render(
      <AdminSagas {...listProps({ error: "slug_taken" })} />,
    );

    expect(html).toMatch(/role="alert"[^>]*>[^<]*Ya existe una saga/);
  });

  it("says there are no sagas when there are none", async () => {
    const html = await render(<AdminSagas {...listProps({ sagas: [] })} />);

    expect(html).toContain("Todavía no hay sagas.");
  });
});

const sagaProps = (
  saga: Record<string, unknown> = {},
  members: unknown[] | null = null,
  error: string | null = null,
) =>
  ({
    loaderData: {
      title: "Sagas",
      publishableKey: "pk_test_x",
      error,
      saga: {
        id: "id-1",
        slug: "dune",
        title: "Dune",
        titles: { es: "Dune ES", en: "Dune" },
        status: "draft",
        origin: "wikidata",
        ...saga,
      },
      members: members ?? [
        {
          qid: "Q1",
          position: 0,
          format: "book",
          labels: { en: "Dune (novel)" },
          year: 1965,
        },
        {
          qid: "Q2",
          position: 1,
          format: "movie",
          labels: { es: "Dune (película)", en: "Dune (film)" },
          year: 2021,
        },
        { qid: "Q3", position: 2, format: null, labels: {}, year: null },
      ],
    },
  }) as unknown as Parameters<typeof AdminSaga>[0];

describe("the page of a saga of the administration (SAG-92)", () => {
  it("says it is a draft and offers to publish it, and offers to unpublish a published one", async () => {
    const draft = await render(<AdminSaga {...sagaProps()} />);
    const published = await render(
      <AdminSaga {...sagaProps({ status: "published", origin: "admin" })} />,
    );

    expect(draft).toContain("Es un borrador: los visitantes no la ven.");
    expect(draft).toContain('name="intent" value="publish"');
    expect(draft).not.toContain('name="intent" value="unpublish"');
    expect(published).toContain("Está publicada");
    expect(published).toContain('name="intent" value="unpublish"');
    expect(published).not.toContain('name="intent" value="publish"');
  });

  it("links the public page only for a published saga, as a plain link", async () => {
    const draft = await render(<AdminSaga {...sagaProps()} />);
    const published = await render(
      <AdminSaga {...sagaProps({ status: "published" })} />,
    );

    expect(draft).not.toContain('href="/sagas/dune"');
    const link = published.match(/<a [^>]*href="\/sagas\/dune"[^>]*>/)?.[0];
    expect(link).toBeDefined();
    expect(link).not.toContain("data-discover");
  });

  it("lists the works in order, each in the language of the page, and says which are not described", async () => {
    const html = await render(<AdminSaga {...sagaProps()} />);

    expect(html.indexOf("Dune (novel)")).toBeLessThan(
      html.indexOf("Dune (película)"),
    );
    expect(html).toContain("(1965)");
    expect(html).toContain("Libros");
    expect(html).toContain("Wikidata aún no la describe");
    // A work with no name is told by its code.
    expect(html).toContain(">Q3<");
  });

  it("gives each work its own buttons, named after the work, and none that cannot work", async () => {
    const html = await render(<AdminSaga {...sagaProps()} />);

    expect(html).toContain('aria-label="Quitar Dune (novel)"');
    expect(html).toContain('aria-label="Bajar Dune (novel)"');
    // The first has nothing above it, and the last nothing below.
    expect(html).not.toContain('aria-label="Subir Dune (novel)"');
    expect(html).toContain('aria-label="Subir Dune (película)"');
    expect(html).not.toContain('aria-label="Bajar Q3"');
    expect(html).toContain('aria-label="Subir Q3"');
  });

  it("sends the code and the direction of a move as hidden fields of a POST", async () => {
    const html = await render(<AdminSaga {...sagaProps()} />);

    expect(html).toContain('name="intent" value="move"');
    expect(html).toContain('name="direction" value="down"');
    expect(html).toContain('name="qid" value="Q2"');
    expect(html).toMatch(/<form [^>]*method="post"/);
  });

  it("has a form to add a work by its Wikidata code and one to rename, with the address that does not change", async () => {
    const html = await render(<AdminSaga {...sagaProps()} />);

    expect(html).toContain('name="intent" value="add"');
    expect(html).toContain("Código de Wikidata");
    expect(html).toContain('name="intent" value="rename"');
    expect(html).toContain('value="Dune ES"');
    expect(html).toContain("/sagas/dune");
  });

  it("says why the last change did not happen, and says it in English", async () => {
    const es = await render(
      <AdminSaga {...sagaProps({}, null, "already_there")} />,
    );
    const en = await render(
      <AdminSaga {...sagaProps({}, null, "already_there")} />,
      "en",
    );

    expect(es).toContain("Esa obra ya está en la saga.");
    expect(en).toContain("That work is already in the saga.");
    expect(en).toContain("Works, in the order of the story");
  });

  it("says it has no works when it has none", async () => {
    const html = await render(<AdminSaga {...sagaProps({}, [])} />);

    expect(html).toContain("Todavía no tiene obras.");
  });

  it("links back to the list of sagas", async () => {
    const html = await render(<AdminSaga {...sagaProps()} />);

    expect(html).toMatch(/<a [^>]*href="\/admin\/sagas"/);
  });
});
