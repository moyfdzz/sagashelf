import { describe, expect, it } from "vitest";

import {
  mediaKindsOf,
  normalizeQuery,
  searchTypeSchema,
  similarity,
} from "./normalize";

describe("normalizeQuery", () => {
  it("lowercases, removes accents and tidies spaces", () => {
    expect(normalizeQuery("  Pokémon   GO ")).toBe("pokemon go");
    expect(normalizeQuery("Ñandú")).toBe("nandu");
  });

  it("applies the compatibility form: full-width letters become plain ones", () => {
    expect(normalizeQuery("Ｄｕｎｅ １９８４")).toBe("dune 1984");
  });

  it("keeps letters of other scripts", () => {
    expect(normalizeQuery("進撃の巨人")).toBe("進撃の巨人");
  });

  it("is empty for empty or blank text", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery(" \t\n ")).toBe("");
  });
});

describe("searchTypeSchema", () => {
  it("accepts the types we search and nothing else", () => {
    expect(searchTypeSchema.safeParse("anime").success).toBe(true);
    for (const bad of ["manga", "custom", "", "ANIME", null]) {
      expect(searchTypeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("lists every type when none is chosen", () => {
    expect(mediaKindsOf(undefined)).toEqual([
      "anime",
      "movie",
      "series",
      "book",
    ]);
    expect(mediaKindsOf("movie")).toEqual(["movie"]);
  });
});

describe("similarity", () => {
  it("is 1 for the same text and 0 for texts with nothing in common", () => {
    expect(similarity("dune", "dune")).toBe(1);
    expect(similarity("dune", "xyz")).toBe(0);
  });

  it("is higher for a closer text", () => {
    expect(similarity("pokemon", "pokemn")).toBeGreaterThan(
      similarity("pokemon", "digimon"),
    );
  });

  it("is 0 when either side is empty", () => {
    expect(similarity("", "dune")).toBe(0);
    expect(similarity("dune", "")).toBe(0);
  });
});
