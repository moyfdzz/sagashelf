import { describe, expect, it } from "vitest";

import { avatarInitial } from "./avatar";

describe("avatarInitial (SAG-39)", () => {
  it("is the first letter of the username in capitals", () => {
    expect(avatarInitial("ana_reads")).toBe("A");
    expect(avatarInitial("  zoe")).toBe("Z");
  });

  it("keeps a first character that is one symbol of several code units whole", () => {
    expect(avatarInitial("😀fan")).toBe("😀");
  });

  it("is empty for an empty username", () => {
    expect(avatarInitial("")).toBe("");
    expect(avatarInitial("   ")).toBe("");
  });
});
