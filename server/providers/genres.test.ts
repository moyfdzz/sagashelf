import { describe, expect, it } from "vitest";

import { genres, isGenre, uniqueGenres } from "./genres";

describe("the list of genres", () => {
  it("has no genre twice", () => {
    expect(new Set(genres).size).toBe(genres.length);
  });

  it("writes every key in lowercase with underscores, since it is the key of a text and of a column", () => {
    for (const genre of genres) {
      expect(genre, genre).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

describe("isGenre", () => {
  it("is true only for a key of the list", () => {
    expect(isGenre("sci_fi")).toBe(true);
    expect(isGenre("Sci-Fi")).toBe(false);
    expect(isGenre("")).toBe(false);
    expect(isGenre(7)).toBe(false);
    expect(isGenre(null)).toBe(false);
  });
});

describe("uniqueGenres", () => {
  it("gives each genre once, in the order found, and leaves out what is not one", () => {
    expect(
      uniqueGenres(["drama", "action", "drama", undefined, "nope" as never]),
    ).toEqual(["drama", "action"]);
  });
});
