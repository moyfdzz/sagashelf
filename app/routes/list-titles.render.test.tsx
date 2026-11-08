import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import List from "./lists.$id";
import { AddToList } from "~/components/lists/AddToList";
import { resources } from "~/locales";

// The pages that hold the titles of a list and the button to add one (SAG-113, PR 2).
vi.mock("@clerk/backend", () => ({}));
vi.mock("@clerk/react-router/server", () => ({}));
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/rate-limit", () => ({}));
vi.mock("~server/db/lists", () => ({}));
vi.mock("~server/db/list-items", () => ({}));
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
const first = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaa1";
const second = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaa2";

const title = (mediaId: string, name: string, note: string | null = null) => ({
  mediaId,
  title: name,
  type: "movie",
  year: 2021,
  note,
  href: `/media/movie/x-${mediaId}`,
});

const listProps = (extra: Record<string, unknown> = {}) =>
  ({
    loaderData: {
      title: "Best sci-fi | SagaShelf",
      publishableKey: "pk_test_x",
      notice: null,
      confirming: false,
      list: {
        id,
        title: "Best sci-fi",
        description: "",
        visibility: "private",
        items: 2,
      },
      titles: [title(first, "Dune", "Gift"), title(second, "Arrival")],
      maxTitle: 100,
      maxDescription: 500,
      maxItems: 200,
      maxNote: 500,
      levels: ["public", "friends", "private"],
      ...extra,
    },
    actionData: undefined,
  }) as unknown as Parameters<typeof List>[0];

/** The tag of the button whose accessible name is the given text. */
const buttonNamed = (html: string, name: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`))?.[0] ?? "";

describe("the titles of a list (SAG-113)", () => {
  it("shows them in order, each with a link to its page, its note and its buttons", async () => {
    const html = await render(<List {...listProps()} />);

    expect(html.indexOf("Dune")).toBeLessThan(html.indexOf("Arrival"));
    expect(html).toContain(`href="/media/movie/x-${first}"`);
    expect(html).toContain(">Gift</textarea>");
    expect(html).toContain("2 títulos de 200 posibles.");
    expect(html).toContain('maxLength="500"');
  });

  it("names the title in every button, since an icon says nothing to a screen reader", async () => {
    const html = await render(<List {...listProps()} />);

    expect(buttonNamed(html, "Subir «Dune»")).not.toBe("");
    expect(buttonNamed(html, "Bajar «Arrival»")).not.toBe("");
    expect(buttonNamed(html, "Quitar «Dune» de la lista")).not.toBe("");
    expect(html).toContain("Nota sobre «Dune»");
  });

  it("turns off up for the first title and down for the last, and only those", async () => {
    const html = await render(<List {...listProps()} />);

    // The attribute, not the `disabled:` variant that every one of these classes has.
    expect(buttonNamed(html, "Subir «Dune»")).toContain('disabled=""');
    expect(buttonNamed(html, "Bajar «Dune»")).not.toContain('disabled=""');
    expect(buttonNamed(html, "Subir «Arrival»")).not.toContain('disabled=""');
    expect(buttonNamed(html, "Bajar «Arrival»")).toContain('disabled=""');
  });

  it("posts each button to the list with the intent, the title and, for a move, the direction", async () => {
    const html = await render(<List {...listProps()} />);

    expect(html).toContain('name="intent" value="move_item"');
    expect(html).toContain('name="direction" value="down"');
    expect(html).toContain('name="intent" value="remove_item"');
    expect(html).toContain('name="intent" value="note_item"');
    expect(html).toContain(`name="mediaId" value="${first}"`);
  });

  it("tells how to add the first title when there are none, and draws no list", async () => {
    const html = await render(
      <List
        {...listProps({
          titles: [],
          list: { ...listProps().loaderData.list, items: 0 },
        })}
      />,
    );

    expect(html).toContain("Esta lista aún no tiene títulos.");
    expect(html).not.toContain("<ol");
  });

  it("shows a refused note above the titles, and a title that is gone", async () => {
    const props = listProps();
    const html = await render(
      <List {...props} actionData={{ error: "invalid_note" }} />,
    );

    expect(html).toMatch(/role="alert"[^>]*>La nota es demasiado larga/);
    // The refusal of a title is not the refusal of the form of the list.
    expect(html).not.toContain("Revisa el nombre");
  });

  it("is written in English too", async () => {
    const html = await render(<List {...listProps()} />, "en");

    expect(html).toContain("Move “Dune” up");
    expect(html).toContain("Remove “Dune” from the list");
    expect(html).toContain("Save note");
  });
});

describe("the button to add a title to a list (SAG-113)", () => {
  const lists = [
    { id: "list-a", title: "Best sci-fi", has: false },
    { id: "list-b", title: "Weekend", has: true },
  ];

  it("offers only the lists that do not have the title, and names the ones that do", async () => {
    const html = await render(<AddToList mediaId={first} lists={lists} />);

    expect(html).toContain('action="/lists/add"');
    expect(html).toContain(`name="mediaId" value="${first}"`);
    expect(html).toMatch(/<option value="list-a">Best sci-fi<\/option>/);
    expect(html).not.toContain('<option value="list-b">');
    expect(html).toContain("Está en:");
    // A page of the session: a plain anchor.
    expect(html).toContain('href="/lists/list-b"');
  });

  it("says so, with no form, when the title is already in every list", async () => {
    const html = await render(
      <AddToList
        mediaId={first}
        lists={[{ id: "list-b", title: "Weekend", has: true }]}
      />,
    );

    expect(html).toContain("ya está en todas tus listas");
    expect(html).not.toContain("<select");
  });

  it("links to the page that makes a list when the person has none", async () => {
    const html = await render(<AddToList mediaId={first} lists={[]} />);

    expect(html).toContain('href="/lists/new"');
    expect(html).toContain("Crea tu primera lista");
    expect(html).not.toContain("<select");
  });

  it("is written in English too", async () => {
    const html = await render(
      <AddToList mediaId={first} lists={lists} />,
      "en",
    );

    expect(html).toContain("Add to a list");
    expect(html).toContain("It is in:");
  });
});
