import { describe, expect, it } from "vitest";

import { isRemoved, removedTitles } from "./removed";

describe("isRemoved", () => {
  const list = new Set(["mangadex:dc332d04-d3b0-413c-a767-70f5e451b031"]);

  it("is true for a title on the list, whatever the case of its id", () => {
    expect(
      isRemoved("mangadex", "DC332D04-D3B0-413C-A767-70F5E451B031", list),
    ).toBe(true);
  });

  it("is false for another title, and for the same id of another provider", () => {
    expect(
      isRemoved("mangadex", "b00acc54-2bf1-440e-8f33-da87227d82d6", list),
    ).toBe(false);
    expect(
      isRemoved("tmdb", "dc332d04-d3b0-413c-a767-70f5e451b031", list),
    ).toBe(false);
  });

  it("has nothing on the real list until a request arrives", () => {
    expect(removedTitles.size).toBe(0);
    expect(isRemoved("mangadex", "anything")).toBe(false);
  });
});
