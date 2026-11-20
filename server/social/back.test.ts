import { describe, expect, it } from "vitest";

import { socialBackPath } from "./back";

const origin = "https://sagashelf.app";
const cursor = "1763640000123456_0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

describe("socialBackPath (SAG-22)", () => {
  it.each<[string | null, string]>([
    [null, "/social"],
    ["not an address", "/social"],
    [`${origin}/social`, "/social"],
    [`${origin}/social?before=${cursor}`, `/social?before=${cursor}`],
    // A search is not repeated, and a cursor we did not write is dropped.
    [`${origin}/social?q=ana&before=${cursor}`, `/social?before=${cursor}`],
    [`${origin}/social?before=1_x`, "/social"],
    // Never another page or another site.
    [`${origin}/library`, "/social"],
    [`https://evil.example/social?before=${cursor}`, "/social"],
  ])("from %s goes to %s", (referer, expected) => {
    expect(socialBackPath(referer, origin)).toBe(expected);
  });
});
