import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/search";
import { headers, loader, shouldRevalidate } from "./search";

const mocks = vi.hoisted(() => ({
  runSearch: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  getDb: vi.fn(),
  searchLocal: vi.fn(),
  providers: vi.fn<() => { capabilities: { types: string[] } }[]>(),
  getOptionalUser: vi.fn(),
  getEntryStatuses: vi.fn(),
}));

vi.mock("~server/search/pipeline", () => ({ runSearch: mocks.runSearch }));
vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/db/library", () => ({
  getEntryStatuses: mocks.getEntryStatuses,
}));
vi.mock("~server/db/search-local", () => ({
  searchLocal: mocks.searchLocal,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getMediaProviders: () => mocks.providers(),
  getSearchCache: () => ({ get: async () => null, put: async () => undefined }),
  getSearchLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => "es",
}));

beforeEach(() => {
  mocks.runSearch.mockReset().mockResolvedValue({
    results: [],
    failed: [],
    source: "providers",
  });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.getDb.mockReset().mockResolvedValue({ fake: "database" });
  mocks.searchLocal.mockReset().mockResolvedValue([]);
  mocks.providers.mockReset().mockReturnValue([]);
  mocks.getOptionalUser.mockReset().mockResolvedValue(null);
  mocks.getEntryStatuses.mockReset().mockResolvedValue(new Map());
});

const load = (query: string) =>
  loader({
    request: new Request(`http://localhost/search${query}`),
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the search page loader", () => {
  it("asks for a search term and does not search the empty page", async () => {
    const result = await load("");

    expect(result).toMatchObject({ status: "idle", results: [], q: "" });
    expect(mocks.runSearch).not.toHaveBeenCalled();
    // The empty page does not count against the limit either.
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("offers a tab for manga only when a provider answers them", async () => {
    mocks.providers.mockReturnValue([{ capabilities: { types: ["manga"] } }]);

    const result = await load("?q=berserk");

    expect(result.tabs).toEqual(["anime", "movie", "series", "manga"]);
  });

  it("offers a tab for books only when a provider answers them", async () => {
    const without = await load("?q=dune");
    mocks.providers.mockReturnValue([{ capabilities: { types: ["book"] } }]);
    const withBooks = await load("?q=dune");
    const idle = await load("");

    expect(without.tabs).toEqual(["anime", "movie", "series"]);
    expect(withBooks.tabs).toEqual(["anime", "movie", "series", "book"]);
    // The empty page has the tabs too.
    expect(idle.tabs).toEqual(["anime", "movie", "series", "book"]);
  });

  it("does not search for a single letter", async () => {
    const result = await load("?q=a");

    expect(result).toMatchObject({ status: "idle" });
    expect(mocks.runSearch).not.toHaveBeenCalled();
  });

  it("refuses a query that is too long, and does not search", async () => {
    const result = await load(`?q=${"x".repeat(101)}`);

    expect(result).toMatchObject({ status: "too_long" });
    expect((result as { q: string }).q).toHaveLength(100);
    expect(mocks.runSearch).not.toHaveBeenCalled();
  });

  it("runs the search with the type and the language", async () => {
    mocks.runSearch.mockResolvedValue({
      results: [{ title: "Dune" }],
      failed: ["tmdb"],
      source: "providers",
    });

    const result = await load("?q=%20dune%20&type=movie");

    expect(mocks.runSearch.mock.calls[0][1]).toEqual({
      query: "dune",
      type: "movie",
      locale: "es",
    });
    expect(result).toMatchObject({
      status: "done",
      q: "dune",
      type: "movie",
      results: [{ title: "Dune" }],
      failed: ["tmdb"],
    });
  });

  it("links a title we hold to its page and one we do not to the address that saves it", async () => {
    const hit = {
      type: "movie",
      title: "Dune",
      provider: "tmdb",
      externalId: "movie/438631",
      imageUrl: "https://image.tmdb.org/t/p/w500/dune.jpg",
    };
    mocks.runSearch.mockResolvedValue({
      results: [
        { ...hit, id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f" },
        { ...hit, id: null, imageUrl: undefined },
      ],
      failed: [],
      source: "providers",
    });

    const result = (await load("?q=dune")) as {
      results: { href: string; poster: string | null }[];
    };

    // Only the one that is not saved yet needs a whole-page navigation.
    expect(
      (result.results as unknown as { wholePage: boolean }[]).map(
        (entry) => entry.wholePage,
      ),
    ).toEqual([false, true]);
    expect(result.results.map((entry) => entry.href)).toEqual([
      "/media/movie/dune-0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
      "/media/open?provider=tmdb&id=movie%2F438631",
    ]);
    // The poster goes through our proxy; a result kept in the cache before posters has none.
    expect(result.results.map((entry) => entry.poster)).toEqual([
      "/img/tmdb/w92/dune.jpg",
      null,
    ]);
  });

  it("treats a type that is not ours as all of them", async () => {
    await load("?q=dune&type=custom");
    await load("?q=dune&type=%3Cscript%3E");

    expect(mocks.runSearch.mock.calls.map((call) => call[1].type)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("is rate limited, and does not search when over the limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    await expect(load("?q=dune")).rejects.toMatchObject({ status: 429 });
    expect(mocks.runSearch).not.toHaveBeenCalled();
    expect(mocks.limit.mock.calls[0][0].key).toContain("search");
  });

  it("gives the pipeline the database search that opens a connection only when used", async () => {
    await load("?q=dune");
    const deps = mocks.runSearch.mock.calls[0][0];

    expect(mocks.getDb).not.toHaveBeenCalled();
    await deps.searchLocal("dune", undefined, "es");
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.searchLocal).toHaveBeenCalledWith(
      { fake: "database" },
      "dune",
      undefined,
      "es",
    );
  });
});

describe("the headers of the search page", () => {
  it("are never kept by a shared cache", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });
});

describe("the search page loader for a person who is signed in", () => {
  const held = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
  const other = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa";
  const hit = (overrides: Record<string, unknown>) => ({
    type: "movie",
    title: "Dune",
    provider: "tmdb",
    externalId: "movie/1",
    imageUrl: null,
    ...overrides,
  });
  const results = () => [
    hit({ id: held, externalId: "movie/1" }),
    hit({ id: other, externalId: "movie/2" }),
    hit({ id: null, externalId: "movie/3" }),
  ];

  beforeEach(() => {
    mocks.runSearch.mockResolvedValue({
      results: results(),
      failed: [],
      source: "providers",
    });
  });

  it("gives each result we hold the status the person gave it, and none to the others", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    mocks.getEntryStatuses.mockResolvedValue(new Map([[held, "completed"]]));

    const result = (await load("?q=dune")) as {
      signedIn: boolean;
      results: { libraryStatus: string | null }[];
    };

    expect(result.signedIn).toBe(true);
    expect(result.results.map((entry) => entry.libraryStatus)).toEqual([
      "completed",
      null,
      null,
    ]);
  });

  it("asks only for the titles we hold, with the person of the session, in one query", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });

    await load("?q=dune");

    expect(mocks.getEntryStatuses).toHaveBeenCalledTimes(1);
    expect(mocks.getEntryStatuses).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      [held, other],
    );
  });

  it("does not look at the library when the results are only suggestions for the search box", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });

    const result = (await load("?q=dune&suggest=1")) as { signedIn: boolean };

    expect(result.signedIn).toBe(false);
    expect(mocks.getOptionalUser).not.toHaveBeenCalled();
    expect(mocks.getEntryStatuses).not.toHaveBeenCalled();
  });

  it("shows a visitor nothing of a library, and asks the database nothing about one", async () => {
    const result = (await load("?q=dune")) as {
      signedIn: boolean;
      results: { libraryStatus: string | null }[];
    };

    expect(result.signedIn).toBe(false);
    expect(result.results.every((entry) => entry.libraryStatus === null)).toBe(
      true,
    );
    expect(mocks.getEntryStatuses).not.toHaveBeenCalled();
  });

  it("does not ask when there is nothing to look up, and never reads the session for an empty page", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1" });
    mocks.runSearch.mockResolvedValue({
      results: [hit({ id: null, externalId: "movie/9" })],
      failed: [],
      source: "providers",
    });

    await load("?q=dune");
    const empty = (await load("")) as { signedIn: boolean };

    expect(mocks.getEntryStatuses).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      [],
    );
    expect(empty.signedIn).toBe(false);
  });
});

describe("what the search page asks again after a form", () => {
  const after = (formAction: string | undefined) =>
    shouldRevalidate({
      formAction,
      defaultShouldRevalidate: true,
    } as unknown as Parameters<typeof shouldRevalidate>[0]);

  it("does not run the search again when a title is added from a result", () => {
    expect(after("/library/add")).toBe(false);
    expect(after("/library/add-external")).toBe(false);
  });

  it("keeps what the router would do for anything else", () => {
    expect(after(undefined)).toBe(true);
    expect(after("/library/abc/step")).toBe(true);
    expect(after("/library/addx")).toBe(true);
    expect(after("/api/locale")).toBe(true);
  });
});
