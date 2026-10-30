import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "../../testing/msw";
import {
  duneMessiah,
  openLibraryBase,
  openLibraryHandlers,
  type SeenRequest,
} from "../../testing/open-library";
import { providerUserAgent } from "../http";
import { createOpenLibraryProviderWithDefaults } from ".";

// No pauses between retries, so the tests are quick.
const fast = { sleep: async () => undefined, retries: 1 };

function setup(seen: SeenRequest[] = []) {
  mswServer.use(...openLibraryHandlers(seen));
  return createOpenLibraryProviderWithDefaults(fast);
}

describe("the Open Library provider (contract)", () => {
  it("says what it covers and what it owes", () => {
    const provider = setup();

    expect(provider.id).toBe("open_library");
    expect(provider.capabilities).toEqual({
      types: ["book"],
      parts: false,
      trending: false,
    });
    expect(provider.attribution.url).toBe("https://openlibrary.org");
  });

  it("searches books, groups the repeated work and keeps the one with more editions", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    const items = await provider.search("dune", { locale: "es" });

    // In Spanish the work with a clean Spanish title gets it; "Dune / Duna" is two languages in
    // one, so the first keeps its own.
    expect(items.map((item) => item.title)).toEqual([
      "Dune",
      "El messies de Dune",
    ]);
    expect(items[0]).toMatchObject({
      type: "book",
      year: 1965,
      creators: ["Frank Herbert"],
      imageUrl: "https://covers.openlibrary.org/b/id/11481354-L.jpg",
      externalId: { provider: "open_library", id: "OL893414W" },
    });
    const sent = seen[0]?.url.searchParams;
    expect(sent?.get("q")).toBe("dune");
    expect(sent?.get("lang")).toBe("es");
    expect(sent?.get("limit")).toBe("20");
  });

  describe("the title in Spanish", () => {
    const spanishCall = (seen: SeenRequest[]) =>
      seen.filter((request) =>
        request.url.searchParams.get("q")?.endsWith("AND language:spa"),
      );

    it("gives a search result its Spanish title and keeps the one Open Library gave as the original", async () => {
      const provider = setup();

      const items = await provider.search("dune", { locale: "es" });

      expect(items[1]).toMatchObject({
        title: "El messies de Dune",
        originalTitle: "Dune Messiah",
        externalId: { provider: "open_library", id: "OL893461W" },
      });
      expect(items[0]).toMatchObject({ title: "Dune", originalTitle: null });
    });

    it("asks for all the Spanish titles of a search in one call, only for the works it shows", async () => {
      const seen: SeenRequest[] = [];
      const provider = setup(seen);

      await provider.search("dune", { locale: "es" });

      expect(seen).toHaveLength(2);
      const [call] = spanishCall(seen);
      expect(call?.url.searchParams.get("q")).toBe(
        "(key:/works/OL893414W OR key:/works/OL893461W) AND language:spa",
      );
      expect(call?.url.searchParams.get("fields")).toBe(
        "key,editions,editions.title,editions.language",
      );
      expect(call?.url.searchParams.get("limit")).toBe("2");
    });

    it("does not ask for them when the site is in English", async () => {
      const seen: SeenRequest[] = [];
      const provider = setup(seen);

      const items = await provider.search("dune", { locale: "en" });

      expect(spanishCall(seen)).toHaveLength(0);
      expect(seen).toHaveLength(1);
      expect(items.map((item) => item.title)).toEqual(["Dune", "Dune Messiah"]);
    });

    it("keeps the titles Open Library gave when the call for the Spanish ones fails", async () => {
      mswServer.use(
        http.get(`${openLibraryBase}/search.json`, ({ request }) => {
          const q = new URL(request.url).searchParams.get("q") ?? "";
          return q.endsWith("AND language:spa")
            ? HttpResponse.json({}, { status: 503 })
            : HttpResponse.json({ numFound: 1, docs: [duneMessiah] });
        }),
      );
      const provider = createOpenLibraryProviderWithDefaults(fast);

      const items = await provider.search("dune", { locale: "es" });

      expect(items.map((item) => item.title)).toEqual(["Dune Messiah"]);
    });

    it("gives a book its Spanish title when it is opened, the one most of its editions share", async () => {
      const seen: SeenRequest[] = [];
      const provider = setup(seen);

      const book = await provider.getById("OL20036652W", { locale: "es" });

      expect(book).toMatchObject({
        title: "El jardín de las mariposas",
        originalTitle: "The Butterfly Garden",
        // The English title is kept too, for a visitor with the site in English.
        titles: { en: "The Butterfly Garden" },
        creators: ["Dot Hutchison"],
        synopsis: { en: "A girl escapes from a garden of butterflies." },
      });
      expect(seen.map((request) => request.url.pathname)).toEqual([
        "/works/OL20036652W.json",
        "/search.json",
        "/works/OL20036652W/editions.json",
      ]);
    });

    it("reads the genres from the subjects of the work", async () => {
      const provider = setup();

      const book = await provider.getById("OL893414W", { locale: "en" });

      expect(book?.genres).toEqual(["sci_fi", "adventure"]);
    });

    it("says none for a work that has no subjects, so it is not asked about again", async () => {
      const provider = setup();

      const book = await provider.getById("OL20036652W", { locale: "en" });

      expect(book?.genres).toEqual([]);
    });

    it("does not say the genres of a book found by the search, which has no subjects", async () => {
      const provider = setup();

      const books = await provider.search("dune", { locale: "en" });

      expect(books.length).toBeGreaterThan(0);
      for (const book of books) expect(book).not.toHaveProperty("genres");
    });

    it("keeps the English title and asks for nothing more when the site is in English", async () => {
      const seen: SeenRequest[] = [];
      const provider = setup(seen);

      const book = await provider.getById("OL20036652W", { locale: "en" });

      expect(book).toMatchObject({
        title: "The Butterfly Garden",
        originalTitle: null,
      });
      expect(book?.titles).toBeUndefined();
      expect(seen).toHaveLength(2);
    });

    it("keeps the original title when no Spanish edition has a clear title of its own", async () => {
      const provider = setup();

      const book = await provider.getById("OL893414W", { locale: "es" });

      expect(book).toMatchObject({ title: "Dune", originalTitle: null });
    });

    it("keeps the book, with its original title, when the editions cannot be read", async () => {
      mswServer.use(
        http.get(`${openLibraryBase}/works/OL20036652W/editions.json`, () =>
          HttpResponse.json({}, { status: 503 }),
        ),
      );
      const provider = createOpenLibraryProviderWithDefaults(fast);

      const book = await provider.getById("OL20036652W", { locale: "es" });

      expect(book).toMatchObject({ title: "The Butterfly Garden" });
    });

    it("does not ask for the editions of a book with no Spanish edition", async () => {
      const seen: SeenRequest[] = [];
      const provider = setup(seen);

      const book = await provider.getById("OL999W", { locale: "es" });

      expect(book?.title).toBe("No search entry");
      expect(
        seen.some((request) => request.url.pathname.endsWith("editions.json")),
      ).toBe(false);
    });
  });

  it("identifies itself with the User-Agent that earns the higher rate", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    await provider.search("dune", { locale: "en" });

    expect(seen[0]?.headers.get("user-agent")).toBe(providerUserAgent);
  });

  it("finds a book by its ISBN, written with hyphens or as an ISBN-10", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    const hyphens = await provider.search("978-0-441-17271-9", {
      locale: "en",
    });
    const old = await provider.search("0441172717", { locale: "en" });

    expect(hyphens.map((item) => item.title)).toEqual(["Dune"]);
    expect(old.map((item) => item.title)).toEqual(["Dune"]);
    expect(seen.map((request) => request.url.searchParams.get("q"))).toEqual([
      "isbn:9780441172719",
      "isbn:9780441172719",
    ]);
  });

  it("answers an empty list for no match, an empty text or another type", async () => {
    const seen: SeenRequest[] = [];
    const provider = setup(seen);

    expect(await provider.search("qzxwvkjhgfdsa", { locale: "es" })).toEqual(
      [],
    );
    expect(await provider.search("   ", { locale: "es" })).toEqual([]);
    expect(
      await provider.search("dune", { type: "movie", locale: "es" }),
    ).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("reads a work: description from the work, authors and cover from the search", async () => {
    const provider = setup();

    const book = await provider.getById("OL893414W", { locale: "es" });

    expect(book).toMatchObject({
      type: "book",
      title: "Dune",
      year: 1965,
      creators: ["Frank Herbert"],
      imageUrl: "https://covers.openlibrary.org/b/id/11481354-L.jpg",
      // The text is in one language, so it fills English whatever was asked.
      synopsis: {
        en: "Set on the desert planet Arrakis.\n\nA stunning blend of adventure and mysticism.",
      },
    });
  });

  it("accepts the key as the search writes it", async () => {
    const provider = setup();

    const book = await provider.getById("/works/OL893414W", { locale: "en" });

    expect(book?.externalId.id).toBe("OL893414W");
  });

  it("falls back to the work when the search has no entry for it", async () => {
    const provider = setup();

    const book = await provider.getById("OL999W", { locale: "en" });

    expect(book).toMatchObject({
      title: "No search entry",
      imageUrl: "https://covers.openlibrary.org/b/id/42-L.jpg",
      synopsis: { en: "From the work only." },
    });
    expect(book?.creators).toBeUndefined();
  });

  it("does not follow a merged work, so its id is not saved under another row", async () => {
    const provider = setup();

    expect(await provider.getById("OL893415W", { locale: "es" })).toBeNull();
  });

  it("answers null for a work that does not exist or an id that is not one", async () => {
    const provider = setup();

    expect(await provider.getById("OL1W", { locale: "es" })).toBeNull();
    expect(await provider.getById("tv/1429", { locale: "es" })).toBeNull();
    expect(await provider.getById("", { locale: "es" })).toBeNull();
  });

  it("has no parts", async () => {
    expect(await setup().getParts("OL893414W")).toEqual([]);
  });

  it("raises a provider error when Open Library is down", async () => {
    mswServer.use(
      http.get(`${openLibraryBase}/search.json`, () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    const provider = createOpenLibraryProviderWithDefaults(fast);

    await expect(
      provider.search("dune", { locale: "es" }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      provider: "open_library",
    });
  });
});
