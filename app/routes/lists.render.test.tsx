import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Lists from "./lists";
import List from "./lists.$id";
import NewList from "./lists.new";
import { resources } from "~/locales";

// The loaders and the actions are tested in their own files; here only the pages are drawn.
vi.mock("@clerk/backend", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/rate-limit", () => ({}));
vi.mock("~server/db/lists", () => ({}));
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

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const otherId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";
const levels = ["public", "friends", "private"];

const summary = (fields: Record<string, unknown> = {}) => ({
  id,
  title: "Best sci-fi",
  description: null,
  visibility: "private",
  items: 0,
  ...fields,
});

const listsProps = (
  extra: Record<string, unknown> = {},
  actionData?: Record<string, unknown>,
) =>
  ({
    loaderData: {
      title: "Mis listas",
      publishableKey: "pk_test_x",
      notice: null,
      confirming: null,
      lists: [summary()],
      atLimit: false,
      maxLists: 50,
      ...extra,
    },
    actionData,
  }) as unknown as Parameters<typeof Lists>[0];

const newProps = (
  extra: Record<string, unknown> = {},
  actionData?: Record<string, unknown>,
) =>
  ({
    loaderData: {
      title: "Nueva lista | SagaShelf",
      publishableKey: "pk_test_x",
      atLimit: false,
      maxLists: 50,
      maxTitle: 100,
      maxDescription: 500,
      levels,
      ...extra,
    },
    actionData,
  }) as unknown as Parameters<typeof NewList>[0];

const listProps = (
  extra: Record<string, unknown> = {},
  actionData?: Record<string, unknown>,
) =>
  ({
    loaderData: {
      title: "Best sci-fi | SagaShelf",
      publishableKey: "pk_test_x",
      notice: null,
      confirming: false,
      list: {
        id,
        title: "Best sci-fi",
        description: "Space and time",
        visibility: "friends",
        items: 3,
      },
      maxTitle: 100,
      maxDescription: 500,
      levels,
      ...extra,
    },
    actionData,
  }) as unknown as Parameters<typeof List>[0];

/** The radio of a level, with whether it is checked. */
const radio = (html: string, level: string) =>
  html.match(new RegExp(`<input[^>]*value="${level}"[^>]*>`))?.[0] ?? "";

describe("the page of the lists of a person (SAG-113)", () => {
  it("says there are none, and has no form: a list is made on its own page", async () => {
    const html = await render(<Lists {...listsProps({ lists: [] })} />);

    expect(html).toContain("Aún no tienes listas.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="title"');
    expect(html).not.toContain("Nueva lista");
  });

  it("lists each list with a link to it, who sees it and how many titles it has", async () => {
    const html = await render(
      <Lists
        {...listsProps({
          lists: [
            summary({ items: 1, visibility: "public" }),
            summary({
              id: otherId,
              title: "Anime",
              items: 2,
              visibility: "friends",
              description: "Slow ones",
            }),
          ],
        })}
      />,
    );

    expect(html).toContain(`href="/lists/${id}"`);
    expect(html).toContain(`href="/lists/${otherId}"`);
    expect(html).toContain("Pública");
    expect(html).toContain("Amistades");
    expect(html).toContain("1 título");
    expect(html).toContain("2 títulos");
    expect(html).toContain("Slow ones");
  });

  it("has a button that goes to the page of a new list, under the introduction, as a plain anchor", async () => {
    const html = await render(<Lists {...listsProps()} />);

    const button = html.match(
      /<a [^>]*href="\/lists\/new"[^>]*>Crear lista<\/a>/,
    );
    expect(button).not.toBeNull();
    // A page of the session loads a whole new document: no `data-discover` (ADR-018).
    expect(button?.[0]).not.toContain("data-discover");
    expect(html.indexOf('href="/lists/new"')).toBeGreaterThan(
      html.indexOf("Agrupa títulos"),
    );
    expect(html.indexOf('href="/lists/new"')).toBeLessThan(
      html.indexOf(`href="/lists/${id}"`),
    );
  });

  it("gives each list two buttons that are only an icon, named after the list", async () => {
    const html = await render(
      <Lists
        {...listsProps({
          lists: [summary(), summary({ id: otherId, title: "Anime" })],
        })}
      />,
    );

    // The whole tag of the link that has the name, whatever the order of its attributes.
    const tag = (label: string) =>
      html.match(new RegExp(`<a [^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
    const edit = tag("Editar la lista «Anime»");
    const remove = tag("Borrar la lista «Anime»");
    expect(edit).toContain(`href="/lists/${otherId}"`);
    expect(remove).toContain(`href="/lists?confirm=${otherId}"`);
    expect(remove).toContain("bg-danger-bg");
    expect(edit).not.toContain("bg-danger-bg");
    // The owner chose small ones (32 px) over 40 px on 2026-11-08.
    expect(edit).toContain("size-8");
    expect(remove).toContain("size-8");
    expect(html).not.toContain("size-10");
    // The icons are drawn, hidden from a screen reader, and nothing else is written in the buttons.
    expect(html.match(/<svg [^>]*aria-hidden="true"/g)?.length).toBe(4);
    expect(html).toContain("lucide-pencil");
    expect(html).toContain("lucide-trash-2");
    expect(html).not.toContain("<dialog");
  });

  it("asks before deleting a list, in a modal that names it and posts to the page of that list", async () => {
    const html = await render(
      <Lists
        {...listsProps({
          lists: [summary(), summary({ id: otherId, title: "Anime" })],
          confirming: { id: otherId, title: "Anime" },
        })}
      />,
    );

    expect(html.match(/<dialog /g)).toHaveLength(1);
    expect(html).toContain("¿Borrar «Anime»?");
    expect(html).toMatch(
      new RegExp(
        `<form [^>]*action="/lists/${otherId}"[^>]*>\\s*<input type="hidden" name="intent" value="delete"`,
      ),
    );
    expect(html).toContain("Sí, borrar");
    expect(html).toMatch(/<a [^>]*href="\/lists"[^>]*>Cancelar<\/a>/);
  });

  it("draws the text of a person as text, never as markup", async () => {
    const html = await render(
      <Lists
        {...listsProps({
          lists: [
            summary({ title: "<b>bold</b>", description: "<i>slanted</i>" }),
          ],
        })}
      />,
    );

    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;slanted&lt;/i&gt;");
    expect(html).not.toContain("<b>bold");
    expect(html).not.toContain("<i>slanted");
  });

  it("does not offer to make another list at the limit, and says why", async () => {
    const html = await render(<Lists {...listsProps({ atLimit: true })} />);

    expect(html).not.toContain('href="/lists/new"');
    expect(html).toContain("Llegaste al límite de 50 listas");
  });

  it("says what happened", async () => {
    for (const [notice, text] of [
      ["created", "Lista creada."],
      ["saved", "Cambios guardados."],
      ["deleted", "Lista borrada."],
    ]) {
      const html = await render(<Lists {...listsProps({ notice })} />);
      expect(html).toMatch(new RegExp(`role="status"[^>]*>${text}`));
    }
  });

  it("is written in English too", async () => {
    const html = await render(
      <Lists {...listsProps({ lists: [summary({ items: 1 })] })} />,
      "en",
    );

    expect(html).toContain("My lists");
    expect(html).toContain("1 title");
    expect(html).toContain("Create list");
  });
});

describe("the page that makes a list (SAG-113)", () => {
  it("has the form, private unless the person says otherwise, and a way back", async () => {
    const html = await render(<NewList {...newProps()} />);

    expect(html).toContain("Nueva lista");
    expect(html).toContain("Ponle un nombre y decide quién puede verla.");
    expect(html).toContain('name="intent" value="create"');
    expect(html).toContain("Crear lista");
    expect(radio(html, "private")).toContain("checked");
    expect(radio(html, "public")).not.toContain("checked");
    expect(radio(html, "friends")).not.toContain("checked");
    const back = html.match(
      /<a [^>]*href="\/lists"[^>]*>(?:<svg[\s\S]*?<\/svg>)Mis listas<\/a>/,
    );
    expect(back?.[0]).toContain("min-h-10");
    expect(back?.[0]).toContain("lucide-arrow-left");
    expect(back?.[0]).not.toContain("data-discover");
  });

  it("does not draw the form at the limit, and says why", async () => {
    const html = await render(<NewList {...newProps({ atLimit: true })} />);

    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="intent" value="create"');
    expect(html).toContain("Llegaste al límite de 50 listas");
  });

  it("brings back what was written, with the reason, when a form was refused", async () => {
    const html = await render(
      <NewList
        {...newProps(
          {},
          {
            error: "duplicate",
            values: {
              title: "Best sci-fi",
              description: "Space",
              visibility: "public",
            },
          },
        )}
      />,
    );

    expect(html).toMatch(
      /role="alert"[^>]*>Ya tienes una lista con ese nombre/,
    );
    expect(html).toContain('value="Best sci-fi"');
    expect(html).toContain("Space</textarea>");
    expect(radio(html, "public")).toContain("checked");
    expect(radio(html, "private")).not.toContain("checked");
    expect(html).toContain('aria-invalid="true"');
  });

  it("is written in English too", async () => {
    const html = await render(<NewList {...newProps()} />, "en");

    expect(html).toContain("New list");
    expect(html).toContain("Give it a name and choose who can see it.");
    expect(html).toContain("Create list");
    expect(html).toContain("Who can see it");
    expect(html).toMatch(
      /<a [^>]*href="\/lists"[^>]*>(?:<svg[\s\S]*?<\/svg>)My lists<\/a>/,
    );
  });
});

describe("the page of one list (SAG-113)", () => {
  it("shows the list in a form, with the saved visibility chosen", async () => {
    const html = await render(<List {...listProps()} />);

    expect(html).toContain("<h1");
    expect(html).toContain("Best sci-fi");
    expect(html).toContain("3 títulos");
    expect(html).toContain('name="intent" value="save"');
    expect(html).toContain('value="Best sci-fi"');
    expect(html).toContain("Space and time</textarea>");
    expect(radio(html, "friends")).toContain("checked");
    expect(radio(html, "public")).not.toContain("checked");
    expect(html).toContain("Esta lista aún no tiene títulos.");
    // The way back has a back arrow and no forward one, and is tall enough to tap.
    const back = html.match(
      /<a [^>]*href="\/lists"[^>]*>(?:<svg[\s\S]*?<\/svg>)Mis listas<\/a>/,
    );
    expect(back?.[0]).toContain("min-h-10");
    expect(back?.[0]).toContain("lucide-arrow-left");
    expect(back?.[0]).not.toContain("after:content");
  });

  it("draws the delete button in red, as a link that opens the modal, and no dialog yet", async () => {
    const html = await render(<List {...listProps()} />);

    const link = html.match(
      new RegExp(`<a [^>]*href="/lists/${id}\\?confirm=1"[^>]*>Borrar lista<`),
    );
    expect(link?.[0]).toContain("bg-danger-bg");
    expect(html).not.toContain("<dialog");
  });

  it("asks first, in a modal that can be cancelled and that deletes this list", async () => {
    const html = await render(<List {...listProps({ confirming: true })} />);

    expect(html.match(/<dialog /g)).toHaveLength(1);
    expect(html).toContain("¿Borrar «Best sci-fi»?");
    expect(html).toMatch(
      /<dialog[^>]*>[\s\S]*name="intent" value="delete"[\s\S]*Sí, borrar/,
    );
    expect(html).toMatch(
      new RegExp(`<a [^>]*href="/lists/${id}"[^>]*>Cancelar<`),
    );
  });

  it("brings back what was written, with the reason, when a form was refused", async () => {
    const html = await render(
      <List
        {...listProps(
          {},
          {
            error: "duplicate",
            values: {
              title: "Taken name",
              description: "",
              visibility: "private",
            },
          },
        )}
      />,
    );

    expect(html).toMatch(
      /role="alert"[^>]*>Ya tienes una lista con ese nombre/,
    );
    expect(html).toContain('value="Taken name"');
    expect(radio(html, "private")).toContain("checked");
    // The heading still names the saved list, not what was typed.
    expect(html).toMatch(/<h1[^>]*>Best sci-fi</);
  });

  it("is written in English too", async () => {
    const html = await render(
      <List {...listProps({ confirming: true })} />,
      "en",
    );

    expect(html).toContain("Save changes");
    expect(html).toContain("Delete list");
    expect(html).toContain("Delete “Best sci-fi”?");
    expect(html).toContain("Yes, delete");
    expect(html).toContain("3 titles");
  });
});
