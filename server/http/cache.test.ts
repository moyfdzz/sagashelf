import { describe, expect, it } from "vitest";

import {
  mergePrivateHeaders,
  privateHeaders,
  privateRouteHeaders,
} from "./cache";

describe("what a route says about caching", () => {
  it("is never kept by a shared cache", () => {
    expect(privateHeaders).toEqual({ "Cache-Control": "private, no-store" });
    expect(privateRouteHeaders()).toEqual(privateHeaders);
  });

  it("puts the cache rule on top of whatever the loader said", () => {
    const merged = mergePrivateHeaders({
      loaderHeaders: new Headers({ "Cache-Control": "public, max-age=60" }),
      actionHeaders: new Headers(),
    });

    expect(merged.get("Cache-Control")).toBe("private, no-store");
  });

  it("puts it on top of what the action said too", () => {
    const merged = mergePrivateHeaders({
      loaderHeaders: new Headers(),
      actionHeaders: new Headers({ "Cache-Control": "public" }),
    });

    expect(merged.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the cookie of the loader and the cookie of the action, both", () => {
    const loaderHeaders = new Headers();
    loaderHeaders.append("Set-Cookie", "view=grid; Path=/");
    const actionHeaders = new Headers();
    actionHeaders.append("Set-Cookie", "locale=en; Path=/");

    const merged = mergePrivateHeaders({ loaderHeaders, actionHeaders });

    expect(merged.getSetCookie()).toEqual([
      "view=grid; Path=/",
      "locale=en; Path=/",
    ]);
  });

  it("lets another header of the action win over the loader's, and keeps the rest", () => {
    const merged = mergePrivateHeaders({
      loaderHeaders: new Headers({ "X-A": "loader", "X-B": "loader" }),
      actionHeaders: new Headers({ "X-A": "action" }),
    });

    expect(merged.get("X-A")).toBe("action");
    expect(merged.get("X-B")).toBe("loader");
  });

  it("works for a page that has no action, or no loader headers", () => {
    expect(
      mergePrivateHeaders({ loaderHeaders: new Headers({ "X-A": "1" }) }).get(
        "Cache-Control",
      ),
    ).toBe("private, no-store");
    expect(mergePrivateHeaders({}).get("Cache-Control")).toBe(
      "private, no-store",
    );
  });
});
