import { describe, expect, it } from "vitest";

import { escapeLike } from "./escape-like";

describe("escapeLike", () => {
  it("turns the characters LIKE reads as a pattern into plain text", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves everything else as it is", () => {
    expect(escapeLike("Pokémon: la película")).toBe("Pokémon: la película");
    expect(escapeLike("")).toBe("");
  });
});
