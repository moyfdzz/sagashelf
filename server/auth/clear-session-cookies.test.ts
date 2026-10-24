import { describe, expect, it } from "vitest";

import { clearSessionCookies } from "./clear-session-cookies";

const request = (url: string, cookie?: string) =>
  new Request(url, cookie ? { headers: { Cookie: cookie } } : undefined);

describe("clearSessionCookies", () => {
  it("expires the session cookies for the host and for the site domain", () => {
    const cookies = clearSessionCookies(
      request(
        "https://sagashelf.app/settings/delete",
        "__session=abc; __client_uat=123; locale=es",
      ),
    );

    expect(cookies).toEqual([
      "__session=; Path=/; Max-Age=0; Secure; SameSite=Lax",
      "__session=; Domain=sagashelf.app; Path=/; Max-Age=0; Secure; SameSite=Lax",
      "__client_uat=; Path=/; Max-Age=0; Secure; SameSite=Lax",
      "__client_uat=; Domain=sagashelf.app; Path=/; Max-Age=0; Secure; SameSite=Lax",
    ]);
  });

  it("follows the suffix Clerk adds to the names", () => {
    const cookies = clearSessionCookies(
      request(
        "https://sagashelf.app/",
        "__session_Ab1=abc; __client_uat_Ab1=1",
      ),
    );

    expect(cookies.map((cookie) => cookie.split("=")[0])).toEqual([
      "__session_Ab1",
      "__session_Ab1",
      "__client_uat_Ab1",
      "__client_uat_Ab1",
    ]);
  });

  it("leaves every other cookie alone", () => {
    const cookies = clearSessionCookies(
      request("https://sagashelf.app/", "locale=es; theme=dark; __sessionx=1"),
    );

    expect(cookies).toEqual([]);
  });

  it("sets no Domain on a host with no parent domain", () => {
    const cookies = clearSessionCookies(
      request("http://localhost:5173/", "__session=abc"),
    );

    expect(cookies).toEqual([
      "__session=; Path=/; Max-Age=0; Secure; SameSite=Lax",
    ]);
  });
});
