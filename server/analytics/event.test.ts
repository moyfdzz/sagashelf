import { describe, expect, it } from "vitest";

import {
  classifyReferrer,
  collectEventSchema,
  deviceFrom,
  isRobot,
  optedOut,
  utcDay,
  visitorHash,
} from "./event";

const browser =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("collectEventSchema", () => {
  it("accepts one event of every kind", () => {
    const events = [
      { kind: "pageview", path: "/", referrer: "https://www.google.com/" },
      { kind: "engaged", path: "/search", ms: 5000 },
      { kind: "search", path: "/search", type: "anime" },
      { kind: "signup", path: "/sign-up" },
      { kind: "add_to_library", path: "/media/anime/x" },
      { kind: "follow", path: "/u/someone" },
    ];
    for (const event of events) {
      expect(collectEventSchema.safeParse(event).success, event.kind).toBe(
        true,
      );
    }
  });

  it.each([
    [
      "a path with a query string",
      { kind: "pageview", path: "/search?q=secret" },
    ],
    ["a path with a fragment", { kind: "pageview", path: "/a#b" }],
    [
      "a path that is not of this site",
      { kind: "pageview", path: "https://x.test/" },
    ],
    ["a path with a space", { kind: "pageview", path: "/a b" }],
    [
      "a path over 200 characters",
      { kind: "pageview", path: `/${"a".repeat(200)}` },
    ],
    ["an unknown kind", { kind: "keystroke", path: "/" }],
    ["a time on page below zero", { kind: "engaged", path: "/", ms: -1 }],
    [
      "a time on page over four hours",
      { kind: "engaged", path: "/", ms: 14_400_001 },
    ],
    [
      "a time on page that is not whole",
      { kind: "engaged", path: "/", ms: 1.5 },
    ],
    ["a time on page with no time", { kind: "engaged", path: "/" }],
    [
      "a search type that is not a type",
      { kind: "search", path: "/", type: "porn" },
    ],
    ["a search with no type", { kind: "search", path: "/" }],
    ["an empty utm value", { kind: "pageview", path: "/", utmSource: "  " }],
  ])("rejects %s", (_name, event) => {
    expect(collectEventSchema.safeParse(event).success).toBe(false);
  });

  it("drops a field it does not know, so the text of a search never gets through", () => {
    const parsed = collectEventSchema.parse({
      kind: "search",
      path: "/search",
      type: "all",
      query: "my secret title",
    });
    expect(parsed).toEqual({ kind: "search", path: "/search", type: "all" });
  });
});

describe("classifyReferrer", () => {
  const site = "sagashelf.app";

  it.each([
    [undefined, "direct", null],
    ["", "direct", null],
    ["not an address", "direct", null],
    ["https://sagashelf.app/search?q=x", "internal", null],
    ["https://www.sagashelf.app/", "internal", null],
    ["https://www.google.com/", "search", "google.com"],
    ["https://www.google.com.mx/search?q=anime", "search", "google.com.mx"],
    ["https://duckduckgo.com/", "search", "duckduckgo.com"],
    ["https://t.co/abc", "social", "t.co"],
    ["https://old.reddit.com/r/anime", "social", "old.reddit.com"],
    ["https://some-blog.example/post", "other", "some-blog.example"],
  ])("%s is %s", (referrer, expectedClass, expectedHost) => {
    expect(classifyReferrer(referrer, site)).toEqual({
      class: expectedClass,
      host: expectedHost,
    });
  });

  it("never keeps the path or the query of another site", () => {
    const result = classifyReferrer(
      "https://blog.example/private/path?token=1",
      site,
    );
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("token");
  });

  it("does not take a site that merely ends like ours for ours", () => {
    expect(classifyReferrer("https://evilsagashelf.app/", site).class).toBe(
      "other",
    );
  });
});

describe("deviceFrom", () => {
  it("trusts the browser hint first", () => {
    expect(deviceFrom(new Headers({ "Sec-CH-UA-Mobile": "?1" }))).toBe(
      "mobile",
    );
    expect(
      deviceFrom(
        new Headers({ "Sec-CH-UA-Mobile": "?0", "User-Agent": "iPhone" }),
      ),
    ).toBe("desktop");
  });

  it("falls back to the name of the browser", () => {
    expect(
      deviceFrom(new Headers({ "User-Agent": "Mozilla/5.0 (iPhone; CPU)" })),
    ).toBe("mobile");
    expect(deviceFrom(new Headers({ "User-Agent": browser }))).toBe("desktop");
    expect(deviceFrom(new Headers())).toBe("desktop");
  });
});

describe("optedOut", () => {
  it("honors Do Not Track and Global Privacy Control", () => {
    expect(optedOut(new Headers({ DNT: "1" }))).toBe(true);
    expect(optedOut(new Headers({ "Sec-GPC": "1" }))).toBe(true);
  });

  it("counts a visitor who did not ask", () => {
    expect(optedOut(new Headers())).toBe(false);
    expect(optedOut(new Headers({ DNT: "0", "Sec-GPC": "0" }))).toBe(false);
  });
});

describe("isRobot", () => {
  it("does not count crawlers, tools or a call with no browser name", () => {
    expect(
      isRobot(
        new Headers({
          "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        }),
      ),
    ).toBe(true);
    expect(
      isRobot(new Headers({ "User-Agent": `${browser} HeadlessChrome/130.0` })),
    ).toBe(true);
    expect(
      isRobot(new Headers({ "User-Agent": `${browser} Chrome-Lighthouse` })),
    ).toBe(true);
    expect(isRobot(new Headers())).toBe(true);
  });

  it("counts a person with a browser", () => {
    expect(isRobot(new Headers({ "User-Agent": browser }))).toBe(false);
  });
});

describe("visitorHash", () => {
  it("is 32 hex characters and always the same for the same day and caller", async () => {
    const first = await visitorHash("salt-a", "203.0.113.7", browser);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await visitorHash("salt-a", "203.0.113.7", browser)).toBe(first);
  });

  it("changes with the salt, so a visitor cannot be followed across days", async () => {
    expect(await visitorHash("salt-a", "203.0.113.7", browser)).not.toBe(
      await visitorHash("salt-b", "203.0.113.7", browser),
    );
  });

  it("changes with the address and with the browser", async () => {
    const base = await visitorHash("salt-a", "203.0.113.7", browser);
    expect(await visitorHash("salt-a", "203.0.113.8", browser)).not.toBe(base);
    expect(await visitorHash("salt-a", "203.0.113.7", "other")).not.toBe(base);
  });

  it("does not contain the address", async () => {
    expect(await visitorHash("salt-a", "203.0.113.7", browser)).not.toContain(
      "203",
    );
  });
});

describe("utcDay", () => {
  it("is the day in UTC, not in the place of the server", () => {
    expect(utcDay(new Date("2026-11-12T23:59:59Z"))).toBe("2026-11-12");
    expect(utcDay(new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
  });
});
