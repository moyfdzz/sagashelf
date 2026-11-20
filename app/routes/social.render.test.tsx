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
    feed: { items: [], next: null, older: false },
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

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
  kind: "completed",
  progress: null,
  score: null,
  createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  level: "public",
  mine: false,
  actor: { username: "ana_reads", displayName: "Ana", avatarUrl: null },
  media: {
    href: "/media/anime/frieren-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
    title: "Frieren",
    poster: null,
  },
  likes: 0,
  liked: false,
  ...overrides,
});

const feedPage = (
  items: ReturnType<typeof item>[],
  extra: Record<string, unknown> = {},
) => page({ feed: { items, next: null, older: false, ...extra } });

describe("the feed (SAG-22)", () => {
  it("says what to expect when there is no activity yet", async () => {
    const html = await render(feedPage([]));

    expect(html).toMatch(/<h2[^>]*>Actividad<\/h2>/);
    expect(html).toContain("Todavía no hay actividad.");
    expect(html).not.toContain("Ver actividad anterior");
  });

  it("draws who did what and when, with links to the profile and the title", async () => {
    const html = await render(feedPage([item()]));

    expect(html).toContain('href="/u/ana_reads"');
    expect(html).toContain(">Ana</a>");
    expect(html).toContain("Terminó");
    expect(html).toContain(
      'href="/media/anime/frieren-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"',
    );
    expect(html).toMatch(/<time datetime="[^"]+"[^>]*>hace 2 horas<\/time>/i);
  });

  it.each<[Record<string, unknown>, string, "es" | "en"]>([
    [{ kind: "started" }, "Empezó", "es"],
    [{ kind: "restarted" }, "Started again", "en"],
    [{ kind: "dropped" }, "Abandonó", "es"],
    [{ kind: "rated", score: 8 }, "Calificó con 8/10", "es"],
    [
      { kind: "progressed", progress: { count: 7, unit: "chapters" } },
      "Va en el capítulo 7 de",
      "es",
    ],
    [
      { kind: "progressed", progress: { count: 1, unit: "episodes" } },
      "On episode 1 of",
      "en",
    ],
  ])("says what happened: %j", async (overrides, text, locale) => {
    const html = await render(feedPage([item(overrides)]), locale);

    expect(html).toContain(text);
  });

  it("offers a like that says whether it is pressed, with the count", async () => {
    const html = await render(feedPage([item({ likes: 3, liked: true })]));

    expect(html).toContain('method="post"');
    expect(html).toContain('action="/social"');
    expect(html).toContain('name="activityId"');
    // Pressed: the form takes it back.
    expect(html).toContain('name="liked" value="false"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("3 me gusta");
  });

  it("offers a like on an event not liked yet", async () => {
    const html = await render(feedPage([item()]), "en");

    expect(html).toContain('name="liked" value="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("0 likes");
  });

  it("shows the viewer's own event without a like, and who may see it", async () => {
    const html = await render(
      feedPage([item({ mine: true, level: "friends", likes: 2 })]),
    );

    expect(html).toContain(">Tú</span>");
    expect(html).not.toContain('href="/u/ana_reads"');
    expect(html).not.toContain('name="liked"');
    expect(html).toContain("Solo amigos");
    expect(html).toContain("2 me gusta");
  });

  it("links to the older page and back to the newest", async () => {
    const html = await render(
      feedPage([item()], { next: "1_abc", older: true }),
    );

    expect(html).toContain('href="/social?before=1_abc"');
    expect(html).toContain("Ver actividad anterior");
    expect(html).toContain('href="/social"');
    expect(html).toContain("Volver a lo más reciente");
  });
});
