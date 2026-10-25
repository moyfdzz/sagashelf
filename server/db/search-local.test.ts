import { describe, expect, it } from "vitest";

import { toTsQuery } from "./search-local";

describe("toTsQuery", () => {
  it("requires every word and lets the last one be unfinished", () => {
    expect(toTsQuery("one pie")).toBe("one & pie:*");
    expect(toTsQuery("dune")).toBe("dune:*");
  });

  it("keeps only letters and digits, so the text cannot add operators", () => {
    expect(toTsQuery("a | b & !c")).toBe("a & b & c:*");
    expect(toTsQuery("dune:*) | (x")).toBe("dune & x:*");
    expect(toTsQuery("'; drop table users; --")).toBe("drop & table & users:*");
  });

  it("keeps words of other scripts", () => {
    expect(toTsQuery("進撃の巨人")).toBe("進撃の巨人:*");
  });

  it("is empty when nothing is left", () => {
    expect(toTsQuery("")).toBe("");
    expect(toTsQuery("!!! ???")).toBe("");
  });
});
