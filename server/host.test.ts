import { describe, expect, it } from "vitest";

import { apexRedirectUrl } from "./host";

describe("apexRedirectUrl", () => {
  it("sends www to the apex domain keeping path and query", () => {
    expect(apexRedirectUrl("https://www.sagashelf.app/a/b?x=1&y=2")).toBe(
      "https://sagashelf.app/a/b?x=1&y=2",
    );
  });

  it("does nothing for the apex domain", () => {
    expect(apexRedirectUrl("https://sagashelf.app/a")).toBeNull();
  });

  it("does nothing for preview and workers.dev hosts", () => {
    expect(
      apexRedirectUrl("https://feat-x-sagashelf.moyfdzz.workers.dev/"),
    ).toBeNull();
    expect(apexRedirectUrl("http://localhost:5173/")).toBeNull();
  });

  it("does not match a look-alike host", () => {
    expect(
      apexRedirectUrl("https://www.sagashelf.app.evil.example/"),
    ).toBeNull();
  });
});
