import { createInstance } from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import People from "./u.$username.$kind";
import Profile from "./u.$username";
import { resources } from "~/locales";

// The loaders and the actions are tested in their own files; here only the pages are drawn.
vi.mock("~server/runtime-env", () => ({}));
vi.mock("~server/auth/require", () => ({}));
vi.mock("~server/db/social", () => ({
  maxPage: 100,
  listFollowers: vi.fn(),
  listFollowing: vi.fn(),
  listFriends: vi.fn(),
}));
vi.mock("~server/db/profile-library", () => ({}));

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

const head = {
  username: "ana_reads",
  displayName: "Ana",
  avatarUrl: "https://img.clerk.com/ana",
};

const entry = {
  href: "/media/series/severance-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
  title: "Severance",
  year: 2022,
  score: 9,
  poster: "/img/tmdb/w185/x.jpg",
};

const section = (status: string, total: number) => ({
  status,
  total,
  entries: total === 0 ? [] : [entry],
});

const visitor = {
  kind: "visitor",
  signInPath: "/sign-in?redirect_url=/u/ana_reads",
};

const fullData = (overrides: Record<string, unknown> = {}) => ({
  title: "Ana (@ana_reads) | SagaShelf",
  head,
  you: visitor,
  notice: null,
  view: "full" as const,
  bio: "I watch too much television",
  counts: { followers: 3, following: 1, friends: 1 },
  sections: [
    section("in_progress", 1),
    section("planned", 0),
    section("completed", 14),
  ],
  ...overrides,
});

const cardData = (overrides: Record<string, unknown> = {}) => ({
  title: "Ana (@ana_reads) | SagaShelf",
  head,
  you: visitor,
  notice: null,
  view: "card" as const,
  ...overrides,
});

const profile = (loaderData: unknown) => (
  <Profile {...({ loaderData } as unknown as Parameters<typeof Profile>[0])} />
);

describe("the profile page: a profile seen in full (SAG-107)", () => {
  it("shows the name, the username, the picture, the bio and the counts as links to their pages", async () => {
    const html = await render(profile(fullData()));

    expect(html).toMatch(/<h1[^>]*>Ana<\/h1>/);
    expect(html).toContain("@ana_reads");
    expect(html).toContain('src="https://img.clerk.com/ana"');
    expect(html).toContain("I watch too much television");
    expect(html).toContain('href="/u/ana_reads/followers"');
    expect(html).toContain("3 seguidores");
    expect(html).toContain('href="/u/ana_reads/following"');
    expect(html).toContain("1 siguiendo");
    expect(html).toContain('href="/u/ana_reads/friends"');
    expect(html).toContain("1 amistad");
  });

  it("shows the sections that have something, with their titles, and not the empty ones", async () => {
    const html = await render(profile(fullData()));

    expect(html).toContain("Viendo o leyendo ahora");
    expect(html).toContain("Completadas");
    expect(html).not.toContain("Quiero ver o leer");
    expect(html).toContain(">Severance<");
    expect(html).toContain("Se muestran 1 de 14.");
  });

  it("links a title to its page and hides the picture of it from a screen reader", async () => {
    const html = await render(profile(fullData()));

    expect(html).toContain(`href="${entry.href}"`);
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><img[^>]*alt="[^"]*Severance/,
    );
  });

  it("says that nothing is public when every section is empty", async () => {
    const html = await render(
      profile(
        fullData({
          sections: [
            section("in_progress", 0),
            section("planned", 0),
            section("completed", 0),
          ],
        }),
      ),
    );

    expect(html).toContain("Todavía no hay nada público en esta biblioteca.");
  });

  it("uses an initial when there is no picture, and the username when there is no name", async () => {
    const html = await render(
      profile(
        fullData({ head: { ...head, displayName: null, avatarUrl: null } }),
      ),
    );

    expect(html).toMatch(/<h1[^>]*>ana_reads<\/h1>/);
    expect(html).toMatch(/aria-hidden="true"[^>]*>A<\/div>/);
  });

  it("never draws the bio as markup", async () => {
    const html = await render(
      profile(fullData({ bio: "<img src=x onerror=alert(1)>" })),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("says it in English", async () => {
    const html = await render(profile(fullData()), "en");

    expect(html).toContain("3 followers");
    expect(html).toContain("Watching or reading now");
    expect(html).toContain("Showing 1 of 14.");
  });
});

describe("the profile page: a locked profile shows only its card", () => {
  it("shows the name, the username and the picture, and says it is private", async () => {
    const html = await render(profile(cardData()));

    expect(html).toMatch(/<h1[^>]*>Ana<\/h1>/);
    expect(html).toContain("@ana_reads");
    expect(html).toContain('src="https://img.clerk.com/ana"');
    expect(html).toContain("Este perfil es privado.");
  });

  it("has no bio, no counts, no sections and no list of people to leak", async () => {
    const html = await render(profile(cardData()));

    expect(html).not.toContain("seguidor");
    expect(html).not.toContain("siguiendo");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("/followers");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<section");
  });

  const asking = (overrides: Record<string, unknown> = {}) =>
    profile(
      cardData({
        you: {
          kind: "member",
          following: false,
          canFollow: false,
          canRequest: true,
          requested: false,
          muted: false,
          ...overrides,
        },
      }),
    );
  const intentsOf = (html: string) =>
    [...html.matchAll(/name="intent" value="([^"]+)"/g)].map((m) => m[1]);

  it("offers a person who is signed in a button to request to follow, and no button to follow", async () => {
    const html = await render(asking());

    expect(intentsOf(html)).toEqual(["request", "mute", "block"]);
    expect(html).toContain("Solicitar seguir");
    expect(html).not.toContain('value="follow"');
  });

  it("shows the request as sent, with a way to cancel it, instead of the button", async () => {
    const html = await render(asking({ requested: true }));

    expect(intentsOf(html)).toEqual(["cancel_request", "mute", "block"]);
    // Said to a screen reader only: the button already says it to the eye.
    expect(html).toMatch(/<p class="sr-only">Solicitud enviada<\/p>/);
    expect(html).toContain("Cancelar solicitud");
    expect(html).not.toContain('value="request"');
  });

  it("offers no request to somebody who cannot ask", async () => {
    const html = await render(asking({ canRequest: false }));

    expect(intentsOf(html)).toEqual(["mute", "block"]);
    expect(html).not.toContain("Solicitar seguir");
  });
});

describe("the profile page: the buttons", () => {
  const member = (overrides: Record<string, unknown> = {}) =>
    fullData({
      you: {
        kind: "member",
        following: false,
        canFollow: true,
        muted: false,
        ...overrides,
      },
    });
  const intents = (html: string) =>
    [...html.matchAll(/name="intent" value="([^"]+)"/g)].map((m) => m[1]);

  it("offers a person who is signed in to follow, mute and block, as forms that reload the page", async () => {
    const html = await render(profile(member()));

    expect(intents(html)).toEqual(["follow", "mute", "block"]);
    expect(html).toContain('action="/u/ana_reads"');
    expect(html).toContain('method="post"');
    expect(html).toContain("Bloquear oculta tu perfil para esta persona");
  });

  it("offers to unfollow and unmute when they are on", async () => {
    const html = await render(
      profile(member({ following: true, muted: true })),
    );

    expect(intents(html)).toEqual(["unfollow", "unmute", "block"]);
  });

  describe("unfollowing a Private profile (SAG-124)", () => {
    const asks = (overrides: Record<string, unknown> = {}) =>
      member({
        following: true,
        canFollow: false,
        unfollowAsks: true,
        confirmUnfollow: false,
        ...overrides,
      });

    it("makes Unfollow a plain link to the confirmation, and sends nothing yet", async () => {
      const html = await render(profile(asks()));

      expect(html).toContain('href="/u/ana_reads?confirm=unfollow"');
      expect(intents(html)).toEqual(["mute", "block"]);
      expect(html).not.toContain("tendrás que enviar otra solicitud");
    });

    it("warns, and offers to confirm or to cancel, once it is asked", async () => {
      const html = await render(profile(asks({ confirmUnfollow: true })));

      expect(html).toContain(
        "Este perfil es privado. Si lo dejas de seguir, tendrás que enviar otra solicitud",
      );
      expect(intents(html)).toEqual(["unfollow", "mute", "block"]);
      // Cancel is a link back to the page: it submits nothing.
      expect(html).toMatch(/<a [^>]*href="\/u\/ana_reads"[^>]*>Cancelar<\/a>/);
      expect(html).not.toContain("?confirm=unfollow");
    });

    it("says it in English", async () => {
      const html = await render(profile(asks({ confirmUnfollow: true })), "en");

      expect(html).toContain("This profile is private. If you unfollow it");
      expect(html).toContain(">Cancel</a>");
    });

    it("does not ask for a Public profile: Unfollow stays a button", async () => {
      const html = await render(
        profile(member({ following: true, canFollow: true })),
      );

      expect(intents(html)).toEqual(["unfollow", "mute", "block"]);
      expect(html).not.toContain("confirm=unfollow");
    });
  });

  it("does not offer to follow a profile that cannot be followed", async () => {
    const html = await render(profile(member({ canFollow: false })));

    expect(intents(html)).toEqual(["mute", "block"]);
  });

  it("offers a visitor only a plain link to sign in, and no form", async () => {
    const html = await render(profile(fullData()));

    expect(html).toContain("Inicia sesión para seguir");
    expect(html).toContain('href="/sign-in?redirect_url=/u/ana_reads"');
    expect(html).not.toContain("<form");
  });

  it("offers the owner a plain link to edit the profile, and no form", async () => {
    const html = await render(profile(fullData({ you: { kind: "owner" } })));
    const link =
      html.match(/<a [^>]*href="\/settings\/profile"[^>]*>/)?.[0] ?? "";

    expect(link).not.toContain("data-discover");
    expect(html).toContain("Editar mi perfil");
    expect(html).not.toContain("<form");
  });

  it.each([
    ["followed", "Ahora sigues a esta persona."],
    [
      "too_many",
      "Has seguido o pedido seguir a muchas personas en poco tiempo.",
    ],
    ["unavailable", "No se pudo hacer eso con esta persona."],
  ])("says what happened after %s, in a live region", async (notice, text) => {
    const html = await render(profile(fullData({ notice })));

    expect(html).toMatch(/role="status"[^>]*>[\s\S]*?<p[^>]*>/);
    expect(html).toContain(text);
  });

  it("keeps the live region in the page when there is nothing to say", async () => {
    const html = await render(profile(fullData()));

    expect(html).toContain('role="status"');
  });

  it("says it in English", async () => {
    const html = await render(profile(member()), "en");

    expect(html).toContain("Follow");
    expect(html).toContain("Mute");
    expect(html).toContain("Block");
  });
});

describe("the lists of people of a profile", () => {
  const peopleData = (overrides: Record<string, unknown> = {}) => ({
    title: "Seguidores de @ana_reads | SagaShelf",
    kind: "followers" as const,
    username: "ana_reads",
    page: 1,
    hasMore: false,
    people: [
      {
        username: "ben_one",
        displayName: "Ben",
        avatarUrl: "https://img.clerk.com/b",
      },
      { username: "cat_one", displayName: null, avatarUrl: null },
    ],
    ...overrides,
  });
  const people = (loaderData: unknown) => (
    <People {...({ loaderData } as unknown as Parameters<typeof People>[0])} />
  );

  it("lists each person with a link to their profile, and a way back", async () => {
    const html = await render(people(peopleData()));

    expect(html).toMatch(/<h1[^>]*>Seguidores<\/h1>/);
    expect(html).toContain('href="/u/ben_one"');
    expect(html).toContain('href="/u/cat_one"');
    expect(html).toContain(">Ben<");
    expect(html).toContain("@cat_one");
    expect(html).toContain('href="/u/ana_reads"');
    expect(html).toContain("Volver al perfil");
  });

  it("has an empty state", async () => {
    const html = await render(people(peopleData({ people: [] })));

    expect(html).toContain("Todavía no hay nadie aquí.");
    expect(html).not.toContain("<ul");
  });

  it("pages with links that keep the kind, and only the ones that exist", async () => {
    const first = await render(people(peopleData({ hasMore: true })));
    const middle = await render(people(peopleData({ page: 2, hasMore: true })));
    const last = await render(people(peopleData({ page: 3 })));

    expect(first).toContain('href="/u/ana_reads/followers?page=2"');
    expect(first).not.toContain("Anterior");
    expect(middle).toContain('href="/u/ana_reads/followers?page=1"');
    expect(middle).toContain('href="/u/ana_reads/followers?page=3"');
    expect(last).toContain("Anterior");
    expect(last).not.toContain("Siguiente");
    expect(await render(people(peopleData()))).not.toContain("Paginación");
  });

  it.each([
    ["following", "Siguiendo"],
    ["friends", "Amistades"],
  ])("is called %s in Spanish", async (kind, name) => {
    const html = await render(people(peopleData({ kind })));

    expect(html).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
  });

  it("says it in English", async () => {
    const html = await render(
      people(peopleData({ kind: "friends", people: [] })),
      "en",
    );

    expect(html).toMatch(/<h1[^>]*>Friends<\/h1>/);
    expect(html).toContain("Nobody here yet.");
    expect(html).toContain("Back to the profile");
  });
});
