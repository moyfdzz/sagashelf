import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/trending";
import { headers, loader, meta } from "./trending";
import type { TrendingPage } from "~server/trending/page";

const mocks = vi.hoisted(() => ({ loadTrendingPage: vi.fn(), locale: "es" }));

vi.mock("~server/trending/page", () => ({
  loadTrendingPage: mocks.loadTrendingPage,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getTrendingCache: () => ({ fake: "cache" }),
  getMediaProviders: () => [{ fake: "provider" }],
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${key}:${options.title}` : key,
  }),
  getLocale: () => mocks.locale,
}));

const mediaId = "0197a000-0000-7000-8000-000000000001";

const page = (overrides: Partial<TrendingPage> = {}): TrendingPage => ({
  favorites: {
    mostAdded: [
      {
        mediaId,
        title: "Dune",
        type: "movie",
        year: 2021,
        imageUrl: "https://image.tmdb.org/t/p/w500/dune.jpg",
        people: 4,
        average: null,
      },
    ],
    mostCompleted: [],
    bestRated: [
      {
        mediaId,
        title: "Dune",
        type: "movie",
        year: 2021,
        imageUrl: null,
        people: 3,
        average: 8.5,
      },
    ],
  },
  worldwide: {
    status: "ok",
    source: {
      name: "TMDB",
      url: "https://www.themoviedb.org",
      notice: "This product uses the TMDB API.",
      logo: "/tmdb-logo.svg",
    },
    titles: [
      {
        provider: "tmdb",
        externalId: "movie/603",
        type: "movie",
        title: "The Matrix",
        originalTitle: null,
        year: 1999,
        imageUrl: "https://image.tmdb.org/t/p/w500/matrix.jpg",
      },
    ],
  },
  ...overrides,
});

const call = (path = "/trending") =>
  loader({
    request: new Request(`https://sagashelf.app${path}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

beforeEach(() => {
  mocks.locale = "es";
  mocks.loadTrendingPage.mockReset().mockResolvedValue(page());
});

describe("the loader of the trending page (SAG-23)", () => {
  it("asks for the movies of the last week with nothing in the address", async () => {
    await call();

    expect(mocks.loadTrendingPage).toHaveBeenCalledWith(
      expect.objectContaining({
        db: { fake: "database" },
        cache: { fake: "cache" },
        providers: [{ fake: "provider" }],
        type: "movie",
        locale: "es",
      }),
    );
    const { period } = mocks.loadTrendingPage.mock.calls[0]?.[0] as {
      period: { from: string; to: string };
    };
    expect(period.from < period.to).toBe(true);
  });

  it("asks for the type, the language and the period of the address", async () => {
    mocks.locale = "en";

    const data = await call("/trending?type=anime&period=month");

    expect(mocks.loadTrendingPage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "anime", locale: "en" }),
    );
    expect(data.view).toEqual({ type: "anime", period: "month" });
    expect(data.canonicalUrl).toBe(
      "https://sagashelf.app/trending?type=anime&period=month",
    );
  });

  it("shows the usual page, and points at it, for values it does not know", async () => {
    const data = await call("/trending?type=%27%3B--&period=9999&x=1");

    expect(data.view).toEqual({ type: "movie", period: "week" });
    expect(data.canonicalUrl).toBe("https://sagashelf.app/trending");
    expect(mocks.loadTrendingPage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "movie" }),
    );
  });

  it("links the titles of the site to their page and shows the poster through our proxy", async () => {
    const data = await call();

    expect(data.site.mostAdded).toEqual([
      {
        href: `/media/movie/dune-${mediaId}`,
        title: "Dune",
        poster: "/img/tmdb/w185/dune.jpg",
        people: 4,
        average: null,
      },
    ]);
    expect(data.site.bestRated[0]).toMatchObject({
      poster: null,
      average: 8.5,
    });
    expect(data.minPeople).toBe(3);
  });

  it("opens a worldwide title through the address that saves it, never a provider address", async () => {
    const data = await call();

    expect(data.worldwide).toMatchObject({ status: "ok" });
    expect(data.worldwide.status === "ok" && data.worldwide.titles).toEqual([
      {
        href: "/media/open?provider=tmdb&id=movie%2F603",
        title: "The Matrix",
        year: 1999,
        poster: "/img/tmdb/w185/matrix.jpg",
      },
    ]);
    expect(JSON.stringify(data)).not.toContain("image.tmdb.org");
  });

  it("passes on that the worldwide list is not available or not supported", async () => {
    mocks.loadTrendingPage.mockResolvedValue(
      page({ worldwide: { status: "unavailable" } }),
    );
    expect((await call()).worldwide).toEqual({ status: "unavailable" });

    mocks.loadTrendingPage.mockResolvedValue(
      page({ worldwide: { status: "unsupported" } }),
    );
    expect((await call("/trending?type=book")).worldwide).toEqual({
      status: "unsupported",
    });
  });

  it("titles the page and says it may be indexed", async () => {
    const data = await call();

    const tags = meta({ loaderData: data } as unknown as Route.MetaArgs);
    expect(tags).toEqual([
      { title: "app.pageTitle:trending.title" },
      { name: "description", content: "trending.description" },
      {
        tagName: "link",
        rel: "canonical",
        href: "https://sagashelf.app/trending",
      },
    ]);
    expect(JSON.stringify(tags)).not.toContain("noindex");
  });

  it("is never kept by a shared cache, because the header shows who is signed in", () => {
    expect(headers()).toEqual({
      "Cache-Control": "private, no-store",
    });
  });
});
