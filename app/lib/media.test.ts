import { describe, expect, it } from "vitest";

import { readingContext } from "./media";

describe("readingContext", () => {
  it("says read for books and manga", () => {
    expect(readingContext("book")).toBe("read");
    expect(readingContext("manga")).toBe("read");
  });

  it("keeps the watched wording for everything else", () => {
    for (const type of ["anime", "series", "movie"]) {
      expect(readingContext(type)).toBeUndefined();
    }
  });
});
