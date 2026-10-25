import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library";
import { headers, loader } from "./library";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listEntries: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/library", () => ({ listEntries: mocks.listEntries }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.listEntries.mockReset().mockResolvedValue({ rows: [], total: 0 });
});

const load = (query = "") =>
  loader({
    request: new Request(`https://sagashelf.app/library${query}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the library page loader", () => {
  it("lists the entries of the person of the session, with the filters of the address", async () => {
    await load(
      "?type=anime&status=completed&year=2013&score=8&sort=score&page=2",
    );

    expect(mocks.listEntries).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      {
        type: "anime",
        status: "completed",
        year: 2013,
        score: 8,
        sort: "score",
        page: 2,
      },
    );
  });

  it("ignores filters that are not valid", async () => {
    await load("?type=custom&sort=random&page=0&year=abc");

    expect(mocks.listEntries.mock.calls[0]?.[2]).toEqual({
      sort: "recent",
      page: 1,
    });
  });

  it("gives each row its poster through the proxy, and the number of pages", async () => {
    mocks.listEntries.mockResolvedValue({
      rows: [
        {
          mediaId: "a",
          title: "Dune",
          imageUrl: "https://image.tmdb.org/t/p/w500/dune.jpg",
        },
        { mediaId: "b", title: "Sin imagen", imageUrl: null },
      ],
      total: 49,
    });

    const result = await load();

    expect(result).toMatchObject({
      total: 49,
      pages: 3,
      rows: [
        { mediaId: "a", poster: "/img/tmdb/w185/dune.jpg" },
        { mediaId: "b", poster: null },
      ],
    });
  });

  it("has one page for an empty library", async () => {
    expect(await load()).toMatchObject({ total: 0, pages: 1 });
  });

  it("needs a session, and asks nothing without one", async () => {
    mocks.requireUser.mockRejectedValue(
      new Response(null, { status: 302, headers: { Location: "/sign-in" } }),
    );

    await expect(load()).rejects.toMatchObject({ status: 302 });
    expect(mocks.listEntries).not.toHaveBeenCalled();
  });
});

describe("the headers of the library page", () => {
  it("are never kept by a shared cache", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });
});
