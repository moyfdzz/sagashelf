import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/media.$type.$slug";
import { headers, loader, meta } from "./media.$type.$slug";
import type { MediaDetail } from "~server/db/media-detail";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getEntry: vi.fn(),
  getMediaDetail: vi.fn(),
  getRelatedFormats: vi.fn(),
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
vi.mock("~server/db/wikidata-store", () => ({
  getRelatedFormats: mocks.getRelatedFormats,
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
    genres: [],
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
  mocks.getRelatedFormats.mockReset().mockResolvedValue([]);
  mocks.importMedia.mockReset().mockResolvedValue(null);
  mocks.runInBackground.mockReset();
});

// `suffix` is `.data` for a move inside the site, which asks for the data of the page.
const load = (
  type: string,
  slug: string,
  origin = "https://sagashelf.app",
  suffix = "",
) =>
  loader({
    params: { type, slug },
    request: new Request(`${origin}/media/${type}/${slug}${suffix}`),
    context: {},
  } as unknown as Route.LoaderArgs);

// A visit that starts from a page: the browser sends that page as the `Referer`.
const loadFrom = (referer: string | null, suffix = "") =>
  loader({
    params: { type: "movie", slug: `matrix-${id}` },
    request: new Request(
      `https://sagashelf.app/media/movie/matrix-${id}${suffix}`,
      {
        headers: referer === null ? {} : { Referer: referer },
      },
    ),
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

describe("the other formats of a story (SAG-16)", () => {
  const sagaRelated = [
    {
      qid: "Q1",
      format: "manga",
      labels: { en: "Attack on Titan" },
      media: null,
    },
    {
      qid: "Q2",
      format: "movie",
      labels: {},
      media: {
        id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
        type: "movie",
        title: "Titan Film",
        titles: { es: "Película Titán" },
      },
    },
  ];

  it("groups what Wikidata relates to the title, in the language of the visitor", async () => {
    mocks.getRelatedFormats.mockResolvedValue(sagaRelated);

    const result = (await load("movie", `matrix-${id}`)) as Awaited<
      ReturnType<typeof loader>
    > & { related: unknown };

    expect(mocks.getRelatedFormats).toHaveBeenCalledWith(
      { fake: "database" },
      id,
    );
    expect(result.related).toEqual([
      {
        format: "movie",
        items: [
          {
            qid: "Q2",
            label: "Película Titán",
            href: "/media/movie/pelicula-titan-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70",
          },
        ],
      },
      {
        format: "manga",
        items: [{ qid: "Q1", label: "Attack on Titan", href: null }],
      },
    ]);
  });

  it("still shows the page when the relations cannot be read", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.getRelatedFormats.mockRejectedValue(new TypeError("no table"));

    const result = (await load("movie", `matrix-${id}`)) as {
      related: unknown;
    };

    expect(result.related).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "media.related_failed", error: "TypeError" }),
    );
  });
});

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

  it("gives the panel of the library the progress of the person and the episodes of the catalog", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    mocks.getEntry.mockResolvedValue({
      status: "in_progress",
      progress: 3,
      progressUnit: null,
      progressTotal: null,
    });
    const episode = (number: number) => ({
      number,
      title: null,
      airDate: null,
      runtime: null,
    });
    mocks.getMediaDetail.mockResolvedValue(
      detail({
        type: "series",
        seasons: [
          {
            number: 0,
            title: "Especiales",
            airDate: null,
            episodes: [episode(1)],
          },
          {
            number: 1,
            title: "T1",
            airDate: null,
            episodes: [episode(1), episode(2)],
          },
          { number: 2, title: "T2", airDate: null, episodes: [episode(1)] },
        ],
      }),
    );

    const result = await load("series", `matrix-${id}`);

    // The special does not count: the end of the series is 3 episodes.
    expect(result).toMatchObject({
      library: {
        signedIn: true,
        status: "in_progress",
        progress: 3,
        progressUnit: null,
        progressTotal: null,
        totalEpisodes: 3,
      },
    });
  });

  it("gives the panel the unit and the total of a book, and nothing for a title with no entry", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    mocks.getEntry.mockResolvedValue({
      status: "in_progress",
      progress: 120,
      progressUnit: "pages",
      progressTotal: 320,
    });
    const book = await load("movie", `matrix-${id}`);
    mocks.getEntry.mockResolvedValue(null);
    const none = await load("movie", `matrix-${id}`);

    expect(book).toMatchObject({
      library: { progress: 120, progressUnit: "pages", progressTotal: 320 },
    });
    expect(none).toMatchObject({
      library: {
        signedIn: true,
        status: null,
        progress: 0,
        progressUnit: null,
        progressTotal: null,
        totalEpisodes: 0,
      },
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

  it("does not send a move inside the site to its own address, which looped forever", async () => {
    const result = await load(
      "movie",
      `matrix-${id}`,
      "https://sagashelf.app",
      ".data",
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({ canonicalUrl: expect.any(String) });
  });

  it("sends a move inside the site to the canonical address once, when the words are wrong", async () => {
    const response = (await load(
      "movie",
      `old-name-${id}`,
      "https://sagashelf.app",
      ".data",
    )) as Response;

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(`/media/movie/matrix-${id}`);
  });

  describe("the link back to the search", () => {
    const back = async (referer: string | null, suffix = "") =>
      ((await loadFrom(referer, suffix)) as { backToSearch: string | null })
        .backToSearch;

    it("goes back to the results the person came from, for a move inside the site and for a new page", async () => {
      const from = "https://sagashelf.app/search?q=the+pitt&type=series";

      expect(await back(from)).toBe("/search?q=the+pitt&type=series");
      expect(await back(from, ".data")).toBe("/search?q=the+pitt&type=series");
    });

    it("has none for a bookmark, a shared link, the library or another site", async () => {
      for (const referer of [
        null,
        "https://sagashelf.app/library",
        "https://sagashelf.app/",
        "https://evil.example/search?q=dune",
        "http://sagashelf.app/search?q=dune",
        "not an address",
      ]) {
        expect(await back(referer)).toBeNull();
      }
    });

    it("never reflects the Referer: only the text and the tab, in an address of the search", async () => {
      const hostile =
        "https://sagashelf.app/search?q=dune&type=book&next=https://evil.example&x=%3Cscript%3E";

      expect(await back(hostile)).toBe("/search?q=dune&type=book");
    });
  });

  describe("the link back to the entry", () => {
    const entryId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
    const backTo = async (referer: string | null) =>
      ((await loadFrom(referer)) as { backToEntry: string | null }).backToEntry;

    it("goes back to the entry the person came from", async () => {
      expect(await backTo(`https://sagashelf.app/library/${entryId}`)).toBe(
        `/library/${entryId}`,
      );
    });

    it("has none from the search, the library, a bookmark or another site", async () => {
      for (const referer of [
        null,
        "https://sagashelf.app/search?q=dune",
        "https://sagashelf.app/library",
        `https://sagashelf.app/library/${entryId}/step`,
        "https://sagashelf.app/library/not-an-id",
        `https://evil.example/library/${entryId}`,
      ]) {
        expect(await backTo(referer)).toBeNull();
      }
    });

    it("shows one link at most: the one of the search is not there when the visit came from an entry", async () => {
      const result = (await loadFrom(
        `https://sagashelf.app/library/${entryId}`,
      )) as { backToSearch: string | null; backToEntry: string | null };

      expect(result.backToSearch).toBeNull();
      expect(result.backToEntry).toBe(`/library/${entryId}`);
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
