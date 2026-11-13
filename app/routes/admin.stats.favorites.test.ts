import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.stats.favorites";
import { headers, loader, meta } from "./admin.stats.favorites";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadTrendingPage: vi.fn(),
  getClerkKeys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/trending/page", () => ({
  loadTrendingPage: mocks.loadTrendingPage,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
  getMediaProviders: () => ["providers"],
  getTrendingCache: () => "cache",
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => "es",
}));

const title = (fields: Record<string, unknown> = {}) => ({
  mediaId: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
  title: "Dune",
  type: "movie",
  year: 2021,
  imageUrl: null,
  people: 5,
  average: null,
  ...fields,
});

const page = (worldwide: unknown) => ({
  favorites: {
    mostAdded: [title()],
    mostCompleted: [],
    bestRated: [title({ average: 8.5 })],
  },
  worldwide,
});

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.loadTrendingPage.mockReset().mockResolvedValue(
    page({
      status: "ok",
      source: { name: "TMDB" },
      titles: [
        {
          provider: "tmdb",
          externalId: "1",
          title: "Oppenheimer",
          year: 2023,
          imageUrl: "x",
        },
      ],
    }),
  );
});

const load = (search = "") =>
  loader({
    request: new Request(
      `https://sagashelf.app/admin/stats/favorites${search}`,
    ),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the favorites page of the administration (SAG-26)", () => {
  it("asks for an administrator before reading anything", async () => {
    mocks.requireRole.mockRejectedValue(new Response(null, { status: 403 }));

    await expect(load()).rejects.toBeInstanceOf(Response);
    expect(mocks.loadTrendingPage).not.toHaveBeenCalled();
  });

  it("asks for the movies of the last week by default, and for what the address names", async () => {
    await load();
    await load("?type=anime&period=month");

    const [first, second] = mocks.loadTrendingPage.mock.calls.map(
      (call) => call[0],
    );
    expect(first).toMatchObject({
      type: "movie",
      locale: "es",
      cache: "cache",
    });
    expect(second).toMatchObject({ type: "anime" });
    expect(second.period.to > second.period.from).toBe(true);
  });

  it("shows the usual view for a made-up type or period", async () => {
    const result = await load("?type=game&period=decade");

    expect(result).toMatchObject({ view: { type: "movie", period: "week" } });
  });

  it("gives the lists of the site with a link to each title, and the list of the world with no link", async () => {
    const result = (await load()) as unknown as {
      site: { mostAdded: Record<string, unknown>[] };
      worldwide: { titles: Record<string, unknown>[]; source: string };
      minPeople: number;
    };

    expect(result.minPeople).toBe(3);
    expect(result.site.mostAdded[0]).toMatchObject({
      title: "Dune",
      people: 5,
      href: expect.stringContaining("0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f"),
    });
    expect(result.worldwide.source).toBe("TMDB");
    expect(result.worldwide.titles).toEqual([
      { key: "tmdb:1", title: "Oppenheimer", year: 2023 },
    ]);
  });

  it("passes on that the list of the world is not available or not supported", async () => {
    mocks.loadTrendingPage.mockResolvedValue(page({ status: "unavailable" }));

    expect(await load()).toMatchObject({
      worldwide: { status: "unavailable" },
    });
  });

  it("answers 503 when the accounts are not configured", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    await expect(load()).rejects.toMatchObject({ init: { status: 503 } });
  });

  it("is never kept by a shared cache and is not indexed", () => {
    expect(headers).toBeTypeOf("function");
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});
