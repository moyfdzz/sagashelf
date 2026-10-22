import { describe, expect, it } from "vitest";

import { effectiveTheme, oppositeTheme, readTheme, themeCookie } from "./theme";

describe("readTheme", () => {
  it("reads the mode that was chosen", () => {
    expect(readTheme("theme=dark")).toBe("dark");
    expect(readTheme("theme=light")).toBe("light");
  });

  it("finds it among other cookies", () => {
    expect(readTheme("locale=es; theme=dark; other=1")).toBe("dark");
    expect(readTheme("  theme=light ;locale=en")).toBe("light");
  });

  it("is null when nothing was chosen, so the system can decide", () => {
    expect(readTheme(null)).toBeNull();
    expect(readTheme("")).toBeNull();
    expect(readTheme("locale=es")).toBeNull();
  });

  it("is null for a value that is not a mode, and never trusts it", () => {
    for (const header of [
      "theme=",
      "theme=system",
      "theme=DARK",
      "theme=<script>",
      "theme=dark=light",
    ]) {
      expect(readTheme(header), header).toBeNull();
    }
  });

  it("reads a valid theme even when another cookie next to it is malformed", () => {
    expect(readTheme("theme=dark; evil")).toBe("dark");
  });

  it("does not take another cookie whose name ends the same way", () => {
    expect(readTheme("mytheme=dark")).toBeNull();
  });
});

describe("effectiveTheme", () => {
  it("uses the choice first, even against the system", () => {
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });

  it("follows the system when nothing was chosen", () => {
    expect(effectiveTheme(null, true)).toBe("dark");
  });

  it("is light when nothing was chosen and the system says nothing", () => {
    expect(effectiveTheme(null, false)).toBe("light");
  });
});

describe("oppositeTheme", () => {
  it("switches between the two", () => {
    expect(oppositeTheme("light")).toBe("dark");
    expect(oppositeTheme("dark")).toBe("light");
  });
});

describe("themeCookie", () => {
  it("lasts a year, for the whole site, and is not sent from other sites", () => {
    const cookie = themeCookie("dark", false);

    expect(cookie).toContain("theme=dark");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("is Secure on https only", () => {
    expect(themeCookie("light", true)).toContain("; Secure");
    expect(themeCookie("light", false)).not.toContain("Secure");
  });

  it("can be read back by readTheme", () => {
    expect(readTheme(themeCookie("dark", true))).toBe("dark");
  });
});
