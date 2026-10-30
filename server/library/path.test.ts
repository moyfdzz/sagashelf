import { describe, expect, it } from "vitest";

import { entryBackPath, libraryBackPath, libraryPath } from "./path";
import { libraryQuerySchema, sectionOrder, type LibraryStatus } from "./schema";

const origin = "https://sagashelf.app";

const queryOf = (search: string) =>
  libraryQuerySchema.parse(Object.fromEntries(new URLSearchParams(search)));
const firstPages = Object.fromEntries(
  sectionOrder.map((status) => [status, 1]),
) as Record<LibraryStatus, number>;

describe("libraryPath", () => {
  it("is the plain library when nothing is set", () => {
    const query = queryOf("");

    expect(libraryPath(query, query.pages)).toBe("/library");
  });

  it("keeps the tab, the search, the filters, the sort and the view", () => {
    const query = queryOf(
      "type=book&q=dune&year=1965&score=8&visibility=public&sort=title&view=grid",
    );

    expect(libraryPath(query, query.pages)).toBe(
      "/library?type=book&q=dune&year=1965&score=8&visibility=public&sort=title&view=grid",
    );
  });

  it("keeps an exact score through tabs and pages, and drops it alone or with the other filters (SAG-61)", () => {
    const rated = queryOf("rated=6&year=2014&type=movie");

    expect(libraryPath(rated, rated.pages)).toBe(
      "/library?type=movie&year=2014&rated=6",
    );
    expect(libraryPath(rated, rated.pages, { type: "manga" })).toBe(
      "/library?type=manga&year=2014&rated=6",
    );
    expect(libraryPath(rated, rated.pages, { unrate: true })).toBe(
      "/library?type=movie&year=2014",
    );
    expect(libraryPath(rated, rated.pages, { clear: true })).toBe(
      "/library?type=movie",
    );
  });

  it("keeps a score of none, as the minimum scores are kept", () => {
    const none = queryOf("score=none&type=book");
    const minimum = queryOf("score=8");

    expect(libraryPath(none, none.pages)).toBe("/library?type=book&score=none");
    expect(libraryPath(minimum, minimum.pages)).toBe("/library?score=8");
    // Changing the tab keeps the filter; clearing the filters drops it.
    expect(libraryPath(none, none.pages, { type: "manga" })).toBe(
      "/library?type=manga&score=none",
    );
    expect(libraryPath(none, none.pages, { clear: true })).toBe(
      "/library?type=book",
    );
  });

  it("drops the default sort, and the pages unless it is told to keep them", () => {
    const query = queryOf("sort=recent&completed_page=3");

    expect(libraryPath(query, query.pages)).toBe("/library");
    expect(libraryPath(query, query.pages, { keepPages: true })).toBe(
      "/library?completed_page=3",
    );
  });

  it("changes the tab or the view and sends every section to its first page", () => {
    const query = queryOf("type=book&q=dune&completed_page=3");

    expect(libraryPath(query, query.pages, { type: "manga" })).toBe(
      "/library?type=manga&q=dune",
    );
    expect(libraryPath(query, query.pages, { type: null })).toBe(
      "/library?q=dune",
    );
    expect(libraryPath(query, query.pages, { view: "titles" })).toBe(
      "/library?type=book&q=dune&view=titles",
    );
  });

  it("clears the search and the filters but not the tab", () => {
    const query = queryOf("type=book&q=dune&year=1965&sort=title");

    expect(libraryPath(query, query.pages, { clear: true })).toBe(
      "/library?type=book",
    );
  });

  it("moves one section to another page and keeps the others where they are", () => {
    const query = queryOf("in_progress_page=2&completed_page=4");

    expect(
      libraryPath(query, query.pages, {
        section: { status: "completed", page: 5 },
      }),
    ).toBe("/library?in_progress_page=2&completed_page=5");
    expect(
      libraryPath(query, firstPages, {
        section: { status: "planned", page: 2 },
      }),
    ).toBe("/library?planned_page=2");
  });
});

describe("libraryBackPath", () => {
  it("goes back to the library as the person left it, pages included", () => {
    expect(
      libraryBackPath(
        `${origin}/library?type=series&q=the+pitt&sort=score&view=grid&paused_page=2`,
        origin,
      ),
    ).toBe(
      "/library?type=series&q=the+pitt&sort=score&view=grid&paused_page=2",
    );
  });

  it("goes to the plain library when it had nothing", () => {
    expect(libraryBackPath(`${origin}/library`, origin)).toBe("/library");
    expect(libraryBackPath(`${origin}/library?`, origin)).toBe("/library");
  });

  it("goes back to the library with the entries that were not scored", () => {
    expect(
      libraryBackPath(`${origin}/library?type=series&score=none`, origin),
    ).toBe("/library?type=series&score=none");
    // Only that exact word counts.
    expect(libraryBackPath(`${origin}/library?score=NONE`, origin)).toBe(
      "/library",
    );
  });

  it("ignores a value the library would ignore, as the page does", () => {
    expect(
      libraryBackPath(
        `${origin}/library?type=evil&year=20x6&score=11&sort=bogus&completed_page=abc`,
        origin,
      ),
    ).toBe("/library");
  });

  it("reads only what the library page knows, never anything else the address had", () => {
    expect(
      libraryBackPath(
        `${origin}/library?type=book&next=https://evil.example&x=%3Cscript%3E#frag`,
        origin,
      ),
    ).toBe("/library?type=book");
  });

  it("cuts a search text that is too long, like the page", () => {
    const back = libraryBackPath(
      `${origin}/library?q=${"x".repeat(150)}`,
      origin,
    );

    expect(back).toBe(`/library?q=${"x".repeat(100)}`);
  });

  it("has none without a Referer or with one that is not an address", () => {
    expect(libraryBackPath(null, origin)).toBeNull();
    expect(libraryBackPath("", origin)).toBeNull();
    expect(libraryBackPath("not an address", origin)).toBeNull();
  });

  it("has none when the person did not come from the library", () => {
    for (const referer of [
      `${origin}/`,
      `${origin}/search?q=dune`,
      `${origin}/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f`,
      `${origin}/library/`,
      `${origin}/libraryx`,
      `${origin}/library-evil?type=book`,
      `${origin}/xlibrary`,
      `${origin}/?next=/library`,
      "https://evil.example/library?type=book",
      "http://sagashelf.app/library",
      "https://sagashelf.app.evil.example/library",
      "javascript:alert(1)",
    ]) {
      expect(libraryBackPath(referer, origin)).toBeNull();
    }
  });
});

describe("entryBackPath", () => {
  const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

  it("goes back to the entry the person came from", () => {
    expect(entryBackPath(`${origin}/library/${id}`, origin)).toBe(
      `/library/${id}`,
    );
  });

  it("writes the id in lowercase and keeps nothing else of the address", () => {
    expect(
      entryBackPath(
        `${origin}/library/${id.toUpperCase()}?next=https://evil.example#x`,
        origin,
      ),
    ).toBe(`/library/${id}`);
  });

  it("has none for an id that is not an id, or a longer path", () => {
    for (const referer of [
      `${origin}/library/abc`,
      `${origin}/library/${id}/step`,
      `${origin}/library/${id}/`,
      `${origin}/library/${id}x`,
      `${origin}/library/..%2F${id}`,
      `${origin}/library/%3Cscript%3E`,
      `${origin}/library`,
      `${origin}/library/`,
    ]) {
      expect(entryBackPath(referer, origin)).toBeNull();
    }
  });

  it("has none from the search, a title page, another site or no Referer", () => {
    for (const referer of [
      null,
      "",
      "not an address",
      `${origin}/search?q=dune`,
      `${origin}/media/series/the-pitt-${id}`,
      `https://evil.example/library/${id}`,
      `http://sagashelf.app/library/${id}`,
    ]) {
      expect(entryBackPath(referer, origin)).toBeNull();
    }
  });
});
