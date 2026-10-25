import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/media.$type.$slug";
import { loader, meta } from "./media.$type.$slug";
import type { MediaDetail } from "~server/db/media-detail";

const mocks = vi.hoisted(() => ({
  getMediaDetail: vi.fn(),
  importMedia: vi.fn(),
  runInBackground: vi.fn(),
  locale: "es",
}));

vi.mock("~server/db/media-detail", () => ({
  getMediaDetail: mocks.getMediaDetail,
}));
vi.mock("~server/media/import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~server/media/import")>()),
  importMedia: mocks.importMedia,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getMediaProviders: () => [],
  runInBackground: mocks.runInBackground,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${options.title} | SagaShelf` : key,
  }),
  getLocale: () => mocks.locale,
}));

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

function detail(overrides: Partial<MediaDetail> = {}): MediaDetail {
  return {
    id,
    type: "movie",
    title: "Matrix",
    originalTitle: "The Matrix",
    year: 1999,
    synopsis: { es: "Un programador descubre la verdad." },
    imageUrl: "https://image.tmdb.org/t/p/w500/matrix.jpg",
    status: "finished",
    fetchedAt: new Date(),
    provider: "tmdb",
    externalId: "movie/603",
    seasons: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.locale = "es";
  mocks.getMediaDetail.mockReset().mockResolvedValue(detail());
  mocks.importMedia.mockReset().mockResolvedValue(null);
  mocks.runInBackground.mockReset();
});

const load = (type: string, slug: string, origin = "https://sagashelf.app") =>
  loader({
    params: { type, slug },
    request: new Request(`${origin}/media/${type}/${slug}`),
    context: {},
  } as unknown as Route.LoaderArgs);

async function thrownStatus(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return (thrown as { init?: { status: number } }).init?.status;
  }
  return undefined;
}

describe("the detail page loader", () => {
  it("shows a title with its poster through the proxy and its share data", async () => {
    const result = (await load("movie", `matrix-${id}`)) as Awaited<
      ReturnType<typeof loader>
    > &
      Record<string, unknown>;

    expect(result).toMatchObject({
      title: "Matrix",
      pageTitle: "Matrix | SagaShelf",
      synopsis: "Un programador descubre la verdad.",
      synopsisLocale: "es",
      poster: "/img/tmdb/w342/matrix.jpg",
      shareImageUrl: "https://sagashelf.app/img/tmdb/w500/matrix.jpg",
      canonicalUrl: `https://sagashelf.app/media/movie/matrix-${id}`,
      sourceUrl: "https://www.themoviedb.org/movie/603",
    });
    expect(result.jsonLd).toMatchObject({ "@type": "Movie", name: "Matrix" });
  });

  it("does not ask the provider for a title that is fresh", async () => {
    await load("movie", `matrix-${id}`);

    expect(mocks.runInBackground).not.toHaveBeenCalled();
  });

  it("refreshes an old title after answering, and a failure of that is only logged", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.getMediaDetail.mockResolvedValue(
      detail({ fetchedAt: new Date(Date.now() - 170 * 24 * 60 * 60 * 1000) }),
    );
    mocks.importMedia.mockRejectedValue(new Error("down"));

    await load("movie", `matrix-${id}`);

    expect(mocks.runInBackground).toHaveBeenCalledTimes(1);
    expect(mocks.importMedia).toHaveBeenCalledWith(
      expect.anything(),
      "tmdb",
      "movie/603",
      "es",
    );
    await expect(
      mocks.runInBackground.mock.calls[0]?.[0],
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("media.refresh_failed"),
    );
    log.mockRestore();
  });

  it("shows the other language when the synopsis has none in this one, and says which", async () => {
    mocks.getMediaDetail.mockResolvedValue(
      detail({ synopsis: { en: "A hacker learns the truth." } }),
    );

    const result = await load("movie", `matrix-${id}`);

    expect(result).toMatchObject({
      synopsis: "A hacker learns the truth.",
      synopsisLocale: "en",
    });
  });

  it("goes to the canonical address when the words or the type are wrong", async () => {
    for (const [type, slug] of [
      ["movie", `old-name-${id}`],
      ["series", `matrix-${id}`],
    ]) {
      const response = (await load(type, slug)) as Response;

      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe(
        `/media/movie/matrix-${id}`,
      );
    }
  });

  it("answers 404 for a title we do not hold, a bad id or a type that is not ours", async () => {
    mocks.getMediaDetail.mockResolvedValue(null);
    expect(await thrownStatus(load("movie", `matrix-${id}`))).toBe(404);
    expect(await thrownStatus(load("movie", "matrix"))).toBe(404);
    expect(await thrownStatus(load("custom", `matrix-${id}`))).toBe(404);
  });

  it("gives no image when the stored one is not from a host we serve", async () => {
    mocks.getMediaDetail.mockResolvedValue(
      detail({ imageUrl: "https://evil.example/a.jpg" }),
    );

    const result = await load("movie", `matrix-${id}`);

    expect(result).toMatchObject({ poster: null, shareImageUrl: null });
  });
});

describe("the detail page meta", () => {
  it("has the tags a link preview and a search engine read", async () => {
    const loaderData = (await load(
      "movie",
      `matrix-${id}`,
    )) as Route.MetaArgs["loaderData"];

    const tags = meta({ loaderData } as unknown as Route.MetaArgs);

    expect(tags).toEqual(
      expect.arrayContaining([
        { title: "Matrix | SagaShelf" },
        {
          tagName: "link",
          rel: "canonical",
          href: `https://sagashelf.app/media/movie/matrix-${id}`,
        },
        { property: "og:type", content: "video.movie" },
        { property: "og:title", content: "Matrix" },
        {
          property: "og:image",
          content: "https://sagashelf.app/img/tmdb/w500/matrix.jpg",
        },
        { name: "twitter:card", content: "summary_large_image" },
        expect.objectContaining({
          "script:ld+json": expect.objectContaining({ "@type": "Movie" }),
        }),
      ]),
    );
  });
});
