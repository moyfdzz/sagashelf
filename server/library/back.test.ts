import { describe, expect, it } from "vitest";

import { returnPath } from "./back";

const origin = "https://sagashelf.app";
const fallback = "/library/0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

describe("returnPath", () => {
  it("goes back to a title page", () => {
    expect(
      returnPath(`${origin}/media/series/the-pitt-01a17ed1`, origin, fallback),
    ).toBe("/media/series/the-pitt-01a17ed1");
  });

  it("goes back to the library as it was, with its filters and pages", () => {
    expect(
      returnPath(
        `${origin}/library?type=book&q=dune&completed_page=2`,
        origin,
        fallback,
      ),
    ).toBe("/library?type=book&q=dune&completed_page=2");
    expect(returnPath(`${origin}/library`, origin, fallback)).toBe("/library");
  });

  it("keeps only the path of a title page, never its query or its fragment", () => {
    expect(
      returnPath(
        `${origin}/media/movie/matrix-1?next=https://evil.example#x`,
        origin,
        fallback,
      ),
    ).toBe("/media/movie/matrix-1");
  });

  it("goes to the fallback without a Referer, or with one that is not an address", () => {
    expect(returnPath(null, origin, fallback)).toBe(fallback);
    expect(returnPath("", origin, fallback)).toBe(fallback);
    expect(returnPath("not an address", origin, fallback)).toBe(fallback);
  });

  it("goes to the fallback from any other page, however much it looks like ours", () => {
    for (const referer of [
      `${origin}/`,
      `${origin}/search?q=dune`,
      `${origin}/settings/profile`,
      `${origin}/media/podcast/x-1`,
      `${origin}/media/series/`,
      `${origin}/media/series/Bad_Words-1`,
      `${origin}/media/series/a/b`,
      `${origin}/media/series/${"x".repeat(200)}`,
      `${origin}/medianew/series/x-1`,
      `${origin}/library/${fallback.split("/")[2]}`,
      "https://evil.example/media/series/the-pitt-1",
      "http://sagashelf.app/media/series/the-pitt-1",
      "https://sagashelf.app.evil.example/library",
      "javascript:alert(1)",
    ]) {
      expect(returnPath(referer, origin, fallback)).toBe(fallback);
    }
  });
});
