import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library";
import { headers, loader } from "./library";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listLibrary: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/library", () => ({ listLibrary: mocks.listLibrary }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => "es",
}));

const emptyLibrary = {
  counts: { all: 0, anime: 0, movie: 0, series: 0, book: 0, manga: 0 },
  sections: [],
};

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.listLibrary.mockReset().mockResolvedValue(emptyLibrary);
});

const load = (query = "", cookie?: string) =>
  loader({
    request: new Request(`https://sagashelf.app/library${query}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

// A loader answers with plain data, or with `data()` when it sets a header.
const bodyOf = (answer: unknown) =>
  (answer as { data?: unknown }).data ?? answer;
const cookieOf = (answer: unknown) =>
  (answer as { init?: { headers?: Record<string, string> } }).init?.headers?.[
    "Set-Cookie"
  ];

describe("the library page loader", () => {
  it("lists the library of the person of the session, with what the address says", async () => {
    await load(
      "?type=anime&q=dune&year=2013&score=8&visibility=public&sort=score&completed_page=2",
    );

    expect(mocks.listLibrary).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      {
        type: "anime",
        q: "dune",
        year: 2013,
        score: 8,
        visibility: "public",
        sort: "score",
        pages: {
          in_progress: 1,
          planned: 1,
          paused: 1,
          dropped: 1,
          completed: 2,
        },
      },
      "es",
    );
  });

  it("ignores values that are not valid", async () => {
    await load("?type=custom&sort=random&completed_page=0&year=abc&view=table");

    expect(mocks.listLibrary.mock.calls[0]?.[2]).toMatchObject({
      sort: "recent",
      pages: { completed: 1 },
    });
    expect(mocks.listLibrary.mock.calls[0]?.[2].type).toBeUndefined();
  });

  it("gives each row its poster through the proxy", async () => {
    mocks.listLibrary.mockResolvedValue({
      ...emptyLibrary,
      sections: [
        {
          status: "completed",
          total: 2,
          page: 1,
          pages: 1,
          rows: [
            {
              mediaId: "a",
              title: "Dune",
              imageUrl: "https://image.tmdb.org/t/p/w500/dune.jpg",
            },
            { mediaId: "b", title: "Sin imagen", imageUrl: null },
          ],
        },
      ],
    });

    const body = bodyOf(await load()) as {
      sections: { rows: { poster: string | null }[] }[];
    };

    expect(body.sections[0]?.rows.map((row) => row.poster)).toEqual([
      "/img/tmdb/w185/dune.jpg",
      null,
    ]);
  });

  describe("the view", () => {
    it("is covers when nothing says otherwise", async () => {
      const answer = await load();

      expect(bodyOf(answer)).toMatchObject({ view: "covers" });
      expect(cookieOf(answer)).toBeUndefined();
    });

    it("is the one in the cookie", async () => {
      const answer = await load("", "libraryView=titles");

      expect(bodyOf(answer)).toMatchObject({ view: "titles" });
      expect(cookieOf(answer)).toBeUndefined();
    });

    it("is the one in the address, which is remembered", async () => {
      const answer = await load("?view=grid", "libraryView=titles");

      expect(bodyOf(answer)).toMatchObject({ view: "grid" });
      expect(cookieOf(answer)).toContain("libraryView=grid");
      expect(cookieOf(answer)).toContain("Secure");
    });
  });

  it("needs a session, and asks nothing without one", async () => {
    mocks.requireUser.mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/sign-in" } }),
    );

    await expect(load()).rejects.toMatchObject({ status: 302 });
    expect(mocks.listLibrary).not.toHaveBeenCalled();
  });
});

describe("the headers of the library page", () => {
  const withLoaderHeaders = (loaderHeaders: Headers) =>
    headers({ loaderHeaders } as unknown as Route.HeadersArgs);

  it("are never kept by a shared cache", () => {
    expect(withLoaderHeaders(new Headers()).get("Cache-Control")).toBe(
      "private, no-store",
    );
  });

  it("pass on the cookie of the view", () => {
    const merged = withLoaderHeaders(
      new Headers({ "Set-Cookie": "libraryView=grid; Path=/" }),
    );

    expect(merged.get("Set-Cookie")).toBe("libraryView=grid; Path=/");
    expect(merged.get("Cache-Control")).toBe("private, no-store");
  });
});
