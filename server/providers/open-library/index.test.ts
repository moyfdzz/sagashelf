import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { mswServer } from "../../testing/msw";
import {
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

    expect(items.map((item) => item.title)).toEqual(["Dune", "Dune Messiah"]);
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
