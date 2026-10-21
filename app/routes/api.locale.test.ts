import { describe, expect, it } from "vitest";

import type { Route } from "./+types/api.locale";
import { action, loader } from "./api.locale";
import { localeCookie } from "~/middleware/i18next";

function post(fields: Record<string, string>, origin = "http://localhost") {
  const request = new Request("http://localhost/api/locale", {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams(fields),
  });
  return action({ request } as Route.ActionArgs) as Promise<Response>;
}

describe("POST /api/locale", () => {
  it("saves the language in a cookie and goes back to the page", async () => {
    const response = await post({ locale: "en", redirectTo: "/some/page?x=1" });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/some/page?x=1");
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(await localeCookie.parse(cookie)).toBe("en");
  });

  it("rejects a language that is not supported", async () => {
    const response = await post({ locale: "fr", redirectTo: "/" });

    expect(response.status).toBe(400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects requests that come from another site", async () => {
    const response = await post(
      { locale: "en", redirectTo: "/" },
      "https://evil.example",
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it.each([
    ["//evil.example"],
    ["https://evil.example"],
    ["/\\evil.example"],
    ["evil.example"],
  ])("never redirects outside the site (%s)", async (redirectTo) => {
    const response = await post({ locale: "es", redirectTo });

    expect(response.headers.get("Location")).toBe("/");
  });

  it("goes home when no page is given", async () => {
    const response = await post({ locale: "es" });

    expect(response.headers.get("Location")).toBe("/");
  });
});

describe("GET /api/locale", () => {
  it("goes home", () => {
    expect(loader().headers.get("Location")).toBe("/");
  });
});
