import { describe, expect, it } from "vitest";

import { idFromSlug, isMediaKind, mediaPath, openPath, slugify } from "./slug";

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

describe("slugify", () => {
  it("lowercases, drops accents and joins words with hyphens", () => {
    expect(slugify("Ataque a los Titanes")).toBe("ataque-a-los-titanes");
    expect(slugify("Pokémon: ¡Atrápalos ya!")).toBe("pokemon-atrapalos-ya");
  });

  it("falls back to a word when nothing Latin is left", () => {
    expect(slugify("君の名は。")).toBe("title");
    expect(slugify("")).toBe("title");
  });

  it("is short, and does not end on a hyphen after cutting", () => {
    const slug = slugify("a ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("mediaPath and idFromSlug", () => {
  it("puts the type and the title before the id, and reads the id back", () => {
    const path = mediaPath("anime", "Ataque a los Titanes", id);

    expect(path).toBe(`/media/anime/ataque-a-los-titanes-${id}`);
    expect(idFromSlug(path.split("/").pop() ?? "")).toBe(id);
  });

  it("reads an id with any words before it, in capitals too", () => {
    expect(idFromSlug(`whatever-${id.toUpperCase()}`)).toBe(id);
    expect(idFromSlug(id)).toBe(id);
  });

  it.each(["", "matrix", "matrix-123", `${id}-matrix`, `matrix-${id}x`])(
    "finds no id in %j",
    (slug) => {
      expect(idFromSlug(slug)).toBeNull();
    },
  );
});

describe("isMediaKind", () => {
  it("accepts our kinds and nothing else", () => {
    expect(isMediaKind("movie")).toBe(true);
    expect(isMediaKind("custom")).toBe(false);
    expect(isMediaKind("../x")).toBe(false);
  });
});

describe("openPath", () => {
  it("escapes the id of the source", () => {
    expect(openPath("tmdb", "movie/603")).toBe(
      "/media/open?provider=tmdb&id=movie%2F603",
    );
  });
});
