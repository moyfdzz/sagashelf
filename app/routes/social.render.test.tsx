import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import Social from "./social";
import { resources } from "~/locales";

// The loader is tested in its own file; here only the page is drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));

async function render(element: ReactNode, locale: "es" | "en" = "es") {
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

const page = (overrides: Record<string, unknown> = {}) => {
  const loaderData = {
    title: "Social",
    q: "",
    status: "idle",
    people: [],
    ...overrides,
  };
  return (
    <Social {...({ loaderData } as unknown as Parameters<typeof Social>[0])} />
  );
};

describe("the page of people search (SAG-115)", () => {
  it("has a search box with a label, sent by the address", async () => {
    const html = await render(page());

    expect(html).toMatch(/<h1[^>]*>Social<\/h1>/);
    expect(html).toContain('role="search"');
    expect(html).toContain('for="people-search"');
    expect(html).toContain('id="people-search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('method="get"');
    expect(html).toContain("de al menos 2 caracteres");
  });

  it("keeps what was searched in the field", async () => {
    const html = await render(
      page({ q: "ana", status: "results", people: [] }),
    );

    expect(html).toContain('value="ana"');
  });

  it("asks for more when the search is too short", async () => {
    const html = await render(page({ q: "a", status: "too_short" }));

    expect(html).toContain("Escribe al menos 2 caracteres.");
  });

  it("says so when it finds nobody, escaping what was typed", async () => {
    const html = await render(
      page({ q: "<script>", status: "results", people: [] }),
    );

    expect(html).toContain("No encontramos a nadie");
    expect(html).not.toContain("<script>");
  });

  it("lists each person with a link to the profile", async () => {
    const html = await render(
      page({
        q: "ana",
        status: "results",
        people: [
          {
            username: "ana_reads",
            displayName: "Ana",
            avatarUrl: "https://img.clerk.com/ana",
          },
          { username: "ana_two", displayName: null, avatarUrl: null },
        ],
      }),
      "en",
    );

    expect(html).toContain('aria-label="People found"');
    expect(html).toContain('href="/u/ana_reads"');
    expect(html).toContain('href="/u/ana_two"');
    expect(html).toContain("@ana_reads");
    expect(html).not.toContain("We found nobody");
  });
});
