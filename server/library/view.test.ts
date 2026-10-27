import { describe, expect, it } from "vitest";

import { chooseView, readViewCookie, viewCookieHeader } from "./view";

const withCookie = (cookie: string) =>
  new Request("https://sagashelf.app/library", { headers: { Cookie: cookie } });

describe("readViewCookie", () => {
  it("reads the view among other cookies", () => {
    expect(readViewCookie(withCookie("locale=es; libraryView=grid; a=b"))).toBe(
      "grid",
    );
  });

  it("has nothing when the cookie is missing or says something else", () => {
    expect(
      readViewCookie(new Request("https://sagashelf.app/library")),
    ).toBeUndefined();
    expect(readViewCookie(withCookie("locale=es"))).toBeUndefined();
    expect(readViewCookie(withCookie("libraryView=table"))).toBeUndefined();
    expect(readViewCookie(withCookie("libraryView="))).toBeUndefined();
  });
});

describe("chooseView", () => {
  it("prefers the address, then the cookie, then covers", () => {
    expect(chooseView("titles", "grid")).toBe("titles");
    expect(chooseView(undefined, "grid")).toBe("grid");
    expect(chooseView(undefined, undefined)).toBe("covers");
  });
});

describe("viewCookieHeader", () => {
  it("is a preference cookie for a year, hidden from scripts", () => {
    const header = viewCookieHeader("grid", true);

    expect(header).toContain("libraryView=grid");
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Max-Age=31536000");
    expect(header).toContain("Secure");
  });

  it("is not Secure on a plain http address, such as the local server", () => {
    expect(viewCookieHeader("covers", false)).not.toContain("Secure");
  });
});
