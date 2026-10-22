import { describe, expect, it } from "vitest";

import { signInPath } from "./sign-in-url";

const back = (url: string) =>
  new URL(signInPath(url), "http://localhost").searchParams.get("redirectTo");

describe("signInPath", () => {
  it("comes back to the page that was asked for", () => {
    expect(signInPath("http://localhost/settings/profile")).toBe(
      "/sign-in?redirectTo=%2Fsettings%2Fprofile",
    );
  });

  it("keeps the query of a page", () => {
    expect(back("http://localhost/lists?page=2&sort=new")).toBe(
      "/lists?page=2&sort=new",
    );
  });

  it("turns the data request of a page into the page", () => {
    expect(
      back(
        "http://localhost/settings/profile.data?_routes=routes%2Fsettings.profile",
      ),
    ).toBe("/settings/profile");
  });

  it("turns the data request of the home page into the home page", () => {
    expect(back("http://localhost/_root.data")).toBe("/");
  });

  it("keeps the real parameters of a data request and drops the internal one", () => {
    expect(
      back("http://localhost/lists.data?page=3&_routes=routes%2Flists"),
    ).toBe("/lists?page=3");
  });

  it("never gives a way back that leaves the site", () => {
    // `//evil.example` would be read by a browser as another site.
    expect(back("http://localhost//evil.example/page")).toBe("/");
    expect(back("http://localhost/%5Cevil.example")).not.toMatch(/^\/\\/);
  });

  it("is always a path on this site, whatever the host of the request is", () => {
    expect(signInPath("https://other-host.example/settings/profile")).toBe(
      "/sign-in?redirectTo=%2Fsettings%2Fprofile",
    );
  });
});
