import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/recommendations";
import { headers, loader, meta } from "./recommendations";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getGenreRecommendations: vi.fn(),
  getSagaSuggestions: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/recommendations", () => ({
  getGenreRecommendations: mocks.getGenreRecommendations,
  getSagaSuggestions: mocks.getSagaSuggestions,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => mocks.locale,
}));

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

beforeEach(() => {
  mocks.locale = "es";
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getGenreRecommendations.mockReset().mockResolvedValue({
    likedGenres: 2,
    items: [
      {
        mediaId,
        type: "anime",
        title: "Attack on Titan",
        year: 2013,
        because: ["action", "drama", "mystery", "horror"],
      },
    ],
  });
  mocks.getSagaSuggestions.mockReset().mockResolvedValue([
    {
      slug: "berserk",
      title: "Berserk",
      titles: { es: "Berserk ES", en: "Berserk" },
      missing: [
        {
          qid: "Q1",
          format: "manga",
          labels: { en: "The manga" },
          year: 1989,
          position: 0,
          media: null,
        },
      ],
    },
  ]);
});

const load = () =>
  loader({
    request: new Request("https://sagashelf.app/recommendations"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the recommendations loader (SAG-87)", () => {
  it("reads both signals for the person of the session, and nobody else", async () => {
    await load();

    expect(mocks.getGenreRecommendations).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      "es",
    );
    expect(mocks.getSagaSuggestions).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
    );
  });

  it("gives the titles by genre with their page and the first three genres as the reason", async () => {
    const result = await load();

    expect(result.likedGenres).toBe(2);
    expect(result.genres).toEqual([
      {
        mediaId,
        type: "anime",
        title: "Attack on Titan",
        year: 2013,
        href: `/media/anime/attack-on-titan-${mediaId}`,
        because: ["action", "drama", "mystery"],
      },
    ]);
  });

  it("gives the sagas with the works the person lacks, named in the language of the visitor", async () => {
    const es = await load();
    mocks.locale = "en";
    const en = await load();

    expect(es.sagas).toEqual([
      {
        slug: "berserk",
        title: "Berserk ES",
        more: 0,
        items: [
          {
            qid: "Q1",
            label: "The manga",
            format: "manga",
            year: 1989,
            href: null,
          },
        ],
      },
    ]);
    expect(en.sagas[0]?.title).toBe("Berserk");
    expect(mocks.getGenreRecommendations).toHaveBeenLastCalledWith(
      { fake: "database" },
      "user-1",
      "en",
    );
  });

  it("falls back to Spanish for any language that is not English", async () => {
    mocks.locale = "fr";

    await load();

    expect(mocks.getGenreRecommendations.mock.calls[0]?.[2]).toBe("es");
  });

  it("reads nothing for a visitor, who is sent away", async () => {
    const redirect = new Response(null, { status: 302 });
    mocks.requireUser.mockRejectedValue(redirect);

    await expect(load()).rejects.toBe(redirect);
    expect(mocks.getGenreRecommendations).not.toHaveBeenCalled();
    expect(mocks.getSagaSuggestions).not.toHaveBeenCalled();
  });

  it("is private and not indexed", () => {
    expect(headers().get("Cache-Control")).toBe("private, no-store");
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});
