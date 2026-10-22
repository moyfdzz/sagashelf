import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("keeps a path on this site", () => {
    expect(safeRedirectPath("/lists?page=2")).toBe("/lists?page=2");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "evil",
  ])("falls back to home for %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });
});
