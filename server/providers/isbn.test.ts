import { describe, expect, it } from "vitest";

import { normalizeIsbn } from "./isbn";

describe("normalizeIsbn", () => {
  it("keeps a valid ISBN-13", () => {
    expect(normalizeIsbn("9780441172719")).toBe("9780441172719");
  });

  it("ignores hyphens and spaces", () => {
    expect(normalizeIsbn("978-0-441-17271-9")).toBe("9780441172719");
    expect(normalizeIsbn(" 978 0441 172719 ")).toBe("9780441172719");
  });

  it("converts an ISBN-10 to ISBN-13", () => {
    expect(normalizeIsbn("0441172717")).toBe("9780441172719");
    expect(normalizeIsbn("0-441-17271-7")).toBe("9780441172719");
  });

  it("accepts an X as the check digit of an ISBN-10", () => {
    expect(normalizeIsbn("080442957x")).toBe("9780804429573");
  });

  it("refuses a wrong check digit", () => {
    expect(normalizeIsbn("9780441172710")).toBeNull();
    expect(normalizeIsbn("0441172710")).toBeNull();
  });

  it("refuses what is not an ISBN", () => {
    expect(normalizeIsbn("dune")).toBeNull();
    expect(normalizeIsbn("")).toBeNull();
    expect(normalizeIsbn("12345")).toBeNull();
    // A valid-looking EAN that is not a book.
    expect(normalizeIsbn("4006381333931")).toBeNull();
  });
});
