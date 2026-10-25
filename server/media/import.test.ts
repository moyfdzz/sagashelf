import { beforeEach, describe, expect, it, vi } from "vitest";

import { importMedia, needsRefresh, refreshAfterDays } from "./import";
import type { MediaProvider, NormalizedMedia } from "../providers/types";

const mocks = vi.hoisted(() => ({
  saveMedia: vi.fn(),
  saveParts: vi.fn(),
}));

vi.mock("../db/media-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/media-store")>()),
  saveMedia: mocks.saveMedia,
  saveParts: mocks.saveParts,
}));

const now = Date.UTC(2026, 9, 25);
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);

describe("needsRefresh", () => {
  it("leaves a recent title with its synopsis alone", () => {
    expect(
      needsRefresh(
        { fetchedAt: daysAgo(3), synopsis: { es: "Hola" } },
        "es",
        now,
      ),
    ).toBe(false);
  });

  it("asks again for a title close to the 6 months TMDB allows", () => {
    expect(
      needsRefresh(
        { fetchedAt: daysAgo(refreshAfterDays + 1), synopsis: { es: "Hola" } },
        "es",
        now,
      ),
    ).toBe(true);
    expect(
      needsRefresh(
        { fetchedAt: daysAgo(refreshAfterDays - 1), synopsis: { es: "Hola" } },
        "es",
        now,
      ),
    ).toBe(false);
  });

  it("asks again when the synopsis is only in the other language, but not on every visit", () => {
    const onlyEnglish = { en: "Hello" };

    expect(
      needsRefresh({ fetchedAt: daysAgo(2), synopsis: onlyEnglish }, "es", now),
    ).toBe(true);
    // Saved a minute ago: the source had no text in this language, so wait before asking again.
    expect(
      needsRefresh(
        { fetchedAt: new Date(now - 60_000), synopsis: onlyEnglish },
        "es",
        now,
      ),
    ).toBe(false);
  });
});

const movie: NormalizedMedia = {
  type: "movie",
  title: "Matrix",
  originalTitle: "The Matrix",
  year: 1999,
  synopsis: { es: "Un programador." },
  imageUrl: null,
  status: "finished",
  popularity: 1,
  externalId: { provider: "tmdb", id: "movie/603" },
};

function provider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  return {
    id: "tmdb",
    capabilities: { types: ["movie"], parts: true, trending: false },
    attribution: {
      name: "TMDB",
      url: "https://www.themoviedb.org/",
      notice: "",
    },
    search: vi.fn(),
    getById: vi.fn(async () => movie),
    getParts: vi.fn(async () => []),
    ...overrides,
  };
}

const db = { execute: vi.fn() };

beforeEach(() => {
  mocks.saveMedia.mockReset().mockResolvedValue("id-1");
  mocks.saveParts.mockReset().mockResolvedValue(undefined);
});

describe("importMedia", () => {
  it("asks the provider in the visitor's language and saves the title and its parts", async () => {
    const tmdb = provider();

    const saved = await importMedia(
      { db, providers: [tmdb] },
      "tmdb",
      "movie/603",
      "es",
    );

    expect(saved).toEqual({ id: "id-1", type: "movie", title: "Matrix" });
    expect(tmdb.getById).toHaveBeenCalledWith("movie/603", { locale: "es" });
    expect(mocks.saveMedia).toHaveBeenCalledWith(db, movie);
    expect(mocks.saveParts).toHaveBeenCalledWith(db, "id-1", []);
  });

  it("gives null, and saves nothing, when no provider matches", async () => {
    expect(
      await importMedia({ db, providers: [] }, "tmdb", "movie/603", "es"),
    ).toBeNull();
    expect(mocks.saveMedia).not.toHaveBeenCalled();
  });

  it("gives null, and saves nothing, when the provider does not know the title", async () => {
    const tmdb = provider({ getById: vi.fn(async () => null) });

    expect(
      await importMedia({ db, providers: [tmdb] }, "tmdb", "movie/0", "es"),
    ).toBeNull();
    expect(mocks.saveMedia).not.toHaveBeenCalled();
  });

  it("does not ask for parts from a provider that has none", async () => {
    const tmdb = provider({
      capabilities: { types: ["movie"], parts: false, trending: false },
    });

    await importMedia({ db, providers: [tmdb] }, "tmdb", "movie/603", "es");

    expect(tmdb.getParts).not.toHaveBeenCalled();
    expect(mocks.saveParts).not.toHaveBeenCalled();
  });

  it("keeps the title when its seasons cannot be read", async () => {
    const tmdb = provider({
      getParts: vi.fn(async () => {
        throw new Error("down");
      }),
    });

    const saved = await importMedia(
      { db, providers: [tmdb] },
      "tmdb",
      "movie/603",
      "es",
    );

    expect(saved?.id).toBe("id-1");
  });

  it("lets a failure of the provider reach the caller", async () => {
    const tmdb = provider({
      getById: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });

    await expect(
      importMedia({ db, providers: [tmdb] }, "tmdb", "movie/603", "es"),
    ).rejects.toThrow("timeout");
    expect(mocks.saveMedia).not.toHaveBeenCalled();
  });
});
