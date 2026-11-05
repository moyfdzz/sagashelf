import { describe, expect, it } from "vitest";

import { checkWrite } from "./write-guard";

const post = (headers: Record<string, string> = {}) =>
  new Request("https://sagashelf.app/settings/profile", {
    method: "POST",
    headers,
  });

describe("checkWrite", () => {
  it("lets a request through when it is small and comes from the same site", () => {
    expect(
      checkWrite(
        post({ "Content-Length": "100", Origin: "https://sagashelf.app" }),
        1024,
      ),
    ).toBeNull();
  });

  it("lets a request with no Origin through: it is not from a page of another site", () => {
    expect(checkWrite(post({ "Content-Length": "10" }), 1024)).toBeNull();
  });

  it("treats a request with no Content-Length as empty", () => {
    expect(checkWrite(post(), 1024)).toBeNull();
  });

  it("lets a body of exactly the limit through, and refuses one byte more", () => {
    expect(checkWrite(post({ "Content-Length": "1024" }), 1024)).toBeNull();
    expect(checkWrite(post({ "Content-Length": "1025" }), 1024)).toBe(
      "too_large",
    );
  });

  it.each([
    ["another site", "https://evil.example"],
    ["the same host on another scheme", "http://sagashelf.app"],
    ["the same host on another port", "https://sagashelf.app:8443"],
    ["a subdomain", "https://www.sagashelf.app"],
    ["a sandboxed page, which sends the word null", "null"],
  ])("refuses a request that comes from %s", (_name, origin) => {
    expect(checkWrite(post({ Origin: origin }), 1024)).toBe("foreign_origin");
  });

  it("asks the size first, so a request that is both too big and foreign is too large", () => {
    expect(
      checkWrite(
        post({ "Content-Length": "5000", Origin: "https://evil.example" }),
        1024,
      ),
    ).toBe("too_large");
  });

  it("reads the origin of the request itself, not a fixed address", () => {
    const request = new Request("http://localhost:5173/settings/profile", {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
    });

    expect(checkWrite(request, 1024)).toBeNull();
  });
});
