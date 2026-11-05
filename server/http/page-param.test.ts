import { describe, expect, it } from "vitest";

import { pageParam } from "./page-param";

const ask = (search: string) =>
  pageParam(new Request(`http://localhost/list${search}`), 100);

describe("pageParam", () => {
  it("reads the page", () => {
    expect(ask("?page=3")).toBe(3);
  });

  it("stops at the last page that can be asked for", () => {
    expect(ask("?page=101")).toBe(100);
  });

  it.each(["", "?page=0", "?page=-1", "?page=1.5", "?page=abc"])(
    "answers the first page for %s",
    (search) => {
      expect(ask(search)).toBe(1);
    },
  );
});
