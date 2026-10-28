import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/media.$type.$slug";
import { headers, loader, meta } from "./media.$type.$slug";
import type { MediaDetail } from "~server/db/media-detail";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getEntry: vi.fn(),
  getMediaDetail: vi.fn(),
  importMedia: vi.fn(),
  runInBackground: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/db/library", () => ({ getEntry: mocks.getEntry }));
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
    titles: { es: "Matrix", en: "The Matrix" },
    originalTitle: "The Matrix",
    year: 1999,
    creators: [],
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
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  mocks.getEntry.mockReset().mockResolvedValue(null);
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
      source: {
        name: "tmdb",
        url: "https://www.themoviedb.org/movie/603",
      },
    });
    expect(result.jsonLd).toMatchObject({ "@type": "Movie", name: "Matrix" });
  });

  it("shows a book with its authors, its cover through the proxy and a link to Open Library", async () => {
    mocks.getMediaDetail.mockResolvedValue(
      detail({
        type: "book",
        title: "Dune",
        titles: { es: "Dune", en: "Dune" },
        originalTitle: null,
        year: 1965,
        creators: ["Frank Herbert"],
        synopsis: { en: "Set on the desert planet Arrakis." },
        imageUrl: "https://covers.openlibrary.org/b/id/11481354-L.jpg",
        status: "unknown",
        provider: "open_library",
        externalId: "OL893414W",
      }),
    );

    const result = (await load("book", `dune-${id}`)) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({
      type: "book",
      creators: ["Frank Herbert"],
      poster: "/img/open_library/w342/11481354.jpg",
      // Open Library writes one text, in English: a Spanish visit falls back to it.
      synopsis: "Set on the desert planet Arrakis.",
      synopsisLocale: "en",
      source: {
        name: "openLibrary",
        url: "https://openlibrary.org/works/OL893414W",
      },
    });
    expect(result.jsonLd).toMatchObject({
      "@type": "Book",
      author: [{ "@type": "Person", name: "Frank Herbert" }],
    });
  });

  it("shows a manga with its authors, its cover through the proxy and a link to MangaDex", async () => {
    const mangaId = "00000000-0000-4000-8000-000000000001";
    const cover = "11111111-2222-4333-8444-555555555555.jpg";
    mocks.getMediaDetail.mockResolvedValue(
      detail({
        type: "manga",
        title: "Berserk",
        titles: { es: "Berserk", en: "Berserk" },
        originalTitle: null,
        year: 1989,
        creators: ["Miura Kentarou"],
        synopsis: { es: "Guts caza demonios.", en: "Guts hunts demons." },
        imageUrl: `https://uploads.mangadex.org/covers/${mangaId}/${cover}`,
        status: "ongoing",
        provider: "mangadex",
        externalId: mangaId,
      }),
    );

    const result = (await load("manga", `berserk-${id}`)) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({
      type: "manga",
      creators: ["Miura Kentarou"],
      poster: `/img/mangadex/w342/${mangaId}_${cover}`,
      synopsis: "Guts caza demonios.",
      synopsisLocale: "es",
      source: {
        name: "mangadex",
        label: "MangaDex",
        url: `https://mangadex.org/title/${mangaId}`,
      },
    });
    expect(result.jsonLd).toMatchObject({
      "@type": "Book",
      author: [{ "@type": "Person", name: "Miura Kentarou" }],
    });
  });

  it("offers a visitor the way to sign in and come back to the title", async () => {
    const result = await load("movie", `matrix-${id}`);

    expect(result).toMatchObject({
      library: {
        signedIn: false,
        signInPath: `/sign-in?redirectTo=${encodeURIComponent(`/media/movie/matrix-${id}`)}`,
      },
    });
    expect(mocks.getEntry).not.toHaveBeenCalled();
  });

  it("offers a signed-in person to add the title when it is not in their library", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });

    const result = await load("movie", `matrix-${id}`);

    expect(result).toMatchObject({ library: { signedIn: true, status: null } });
    expect(mocks.getEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      id,
      "es",
    );
  });

  it("shows a signed-in person the status they gave the title", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    mocks.getEntry.mockResolvedValue({ status: "completed" });

    const result = await load("movie", `matrix-${id}`);

    expect(result).toMatchObject({
      library: { signedIn: true, status: "completed" },
    });
  });

  it("is never kept by a shared cache, because it shows the entry of the person", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
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
      undefined,
    );
    await expect(
      mocks.runInBackground.mock.calls[0]?.[0],
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("media.refresh_failed"),
    );
    log.mockRestore();
  });

  it("waits for the provider on the first visit in a language and shows what it brings", async () => {
    mocks.locale = "en";
    mocks.getMediaDetail
      .mockResolvedValueOnce(
        detail({
          titles: { es: "Matrix" },
          synopsis: { es: "Un programador." },
        }),
      )
      .mockResolvedValueOnce(
        detail({
          titles: { es: "Matrix", en: "The Matrix" },
          synopsis: { es: "Un programador.", en: "A hacker." },
        }),
      );
    mocks.importMedia.mockResolvedValue({ id, type: "movie", title: "x" });

    const result = await load("movie", `the-matrix-${id}`);

    expect(mocks.importMedia).toHaveBeenCalledWith(
      expect.anything(),
      "tmdb",
      "movie/603",
      "en",
      expect.any(AbortSignal),
    );
    expect(mocks.runInBackground).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      title: "The Matrix",
      synopsis: "A hacker.",
      synopsisLocale: "en",
    });
  });

  it("shows what it holds, and logs, when the provider fails on the first visit in a language", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.locale = "en";
    mocks.getMediaDetail.mockResolvedValue(
      detail({ titles: { es: "Matrix" }, synopsis: { es: "Un programador." } }),
    );
    mocks.importMedia.mockRejectedValue(new Error("down"));

    const result = await load("movie", `matrix-${id}`);

    expect(result).toMatchObject({
      title: "Matrix",
      synopsis: "Un programador.",
      synopsisLocale: "es",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("media.refresh_failed"),
    );
    log.mockRestore();
  });

  it("uses the title of the visitor's language for the address and the page", async () => {
    mocks.locale = "en";

    const response = (await load("movie", `matrix-${id}`)) as Response;

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(
      `/media/movie/the-matrix-${id}`,
    );
  });

  it("does not ask again for a language the source had no synopsis in", async () => {
    mocks.getMediaDetail.mockResolvedValue(detail({ synopsis: { es: "" } }));

    const result = await load("movie", `matrix-${id}`);

    expect(mocks.importMedia).not.toHaveBeenCalled();
    expect(result).toMatchObject({ synopsis: null });
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
