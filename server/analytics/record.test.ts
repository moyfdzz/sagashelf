import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlExecutor } from "../db/clerk-sync";
import type { NewAnalyticsEvent } from "../db/analytics";
import { forgetCachedSalt, recordEvent } from "./record";

const store = vi.hoisted(() => ({
  getDailySalt:
    vi.fn<
      (db: unknown, day: string, candidate: string) => Promise<string | null>
    >(),
  insertAnalyticsEvent:
    vi.fn<(db: unknown, event: NewAnalyticsEvent) => Promise<void>>(),
}));
vi.mock("../db/analytics", () => store);

const db = {} as SqlExecutor;
const now = new Date("2026-11-12T18:00:00Z");

function visit(
  headers: Record<string, string> = {},
  cf?: Record<string, unknown>,
) {
  const request = new Request("https://sagashelf.app/api/collect", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "203.0.113.7",
      "User-Agent": "Mozilla/5.0 Chrome/130.0",
      ...headers,
    },
  });
  return cf ? Object.assign(request, { cf }) : request;
}

const stored = () =>
  store.insertAnalyticsEvent.mock.calls[0]?.[1] as NewAnalyticsEvent;

beforeEach(() => {
  forgetCachedSalt();
  store.getDailySalt.mockReset().mockResolvedValue("the-salt");
  store.insertAnalyticsEvent.mockReset().mockResolvedValue(undefined);
});

describe("recordEvent", () => {
  it("stores a page view with its source, country and region", async () => {
    await recordEvent(
      db,
      visit({}, { country: "MX", region: "Mexico City", city: "Mexico City" }),
      {
        kind: "pageview",
        path: "/sagas",
        referrer: "https://www.google.com/",
        utmSource: "newsletter",
      },
      now,
    );

    expect(stored()).toMatchObject({
      kind: "pageview",
      path: "/sagas",
      engagedMs: null,
      searchType: null,
      referrerClass: "search",
      referrerHost: "google.com",
      utmSource: "newsletter",
      utmMedium: null,
      country: "MX",
      region: "Mexico City",
      device: "desktop",
    });
    expect(stored().visitor).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never stores the address, the browser or the city", async () => {
    await recordEvent(
      db,
      visit({}, { country: "MX", region: "CDMX", city: "Coyoacan" }),
      { kind: "pageview", path: "/" },
      now,
    );

    const text = JSON.stringify(stored());
    expect(text).not.toContain("203.0.113.7");
    expect(text).not.toContain("Chrome");
    expect(text).not.toContain("Coyoacan");
  });

  it("stores the numbers of a speed event, empty where the browser measured nothing", async () => {
    await recordEvent(
      db,
      visit(),
      { kind: "vitals", path: "/", lcp: 1800.5, inp: 90 },
      now,
    );

    expect(stored()).toMatchObject({
      kind: "vitals",
      path: "/",
      lcpMs: 1800.5,
      cls: null,
      inpMs: 90,
      engagedMs: null,
      searchType: null,
      referrerClass: null,
    });
  });

  it("stores a layout shift of zero, which is a number and not an empty value", async () => {
    await recordEvent(db, visit(), { kind: "vitals", path: "/", cls: 0 }, now);

    expect(stored()).toMatchObject({ lcpMs: null, cls: 0, inpMs: null });
  });

  it("leaves the speed numbers empty for every other kind", async () => {
    await recordEvent(db, visit(), { kind: "pageview", path: "/" }, now);

    expect(stored()).toMatchObject({ lcpMs: null, cls: null, inpMs: null });
  });

  it("keeps only the fields of the kind of event", async () => {
    await recordEvent(
      db,
      visit(),
      { kind: "engaged", path: "/a", ms: 4200 },
      now,
    );
    expect(stored()).toMatchObject({
      engagedMs: 4200,
      searchType: null,
      referrerClass: null,
    });

    store.insertAnalyticsEvent.mockClear();
    await recordEvent(
      db,
      visit(),
      { kind: "search", path: "/search", type: "manga" },
      now,
    );
    expect(stored()).toMatchObject({
      engagedMs: null,
      searchType: "manga",
      utmSource: null,
    });
  });

  it.each([["XX"], ["T1"], ["mx"], ["MEX"]])(
    "does not keep %s as a country",
    async (country) => {
      await recordEvent(
        db,
        visit({}, { country }),
        { kind: "follow", path: "/" },
        now,
      );
      expect(stored().country).toBeNull();
    },
  );

  it("has no country or region outside Cloudflare", async () => {
    await recordEvent(db, visit(), { kind: "follow", path: "/" }, now);
    expect(stored()).toMatchObject({ country: null, region: null });
  });

  it("asks for the salt of the day once, and once more on the next day", async () => {
    const event = { kind: "follow", path: "/" } as const;
    await recordEvent(db, visit(), event, now);
    await recordEvent(db, visit(), event, now);
    expect(store.getDailySalt).toHaveBeenCalledTimes(1);
    expect(store.getDailySalt.mock.calls[0]?.[1]).toBe("2026-11-12");

    await recordEvent(db, visit(), event, new Date("2026-11-13T00:00:01Z"));
    expect(store.getDailySalt).toHaveBeenCalledTimes(2);
    expect(store.getDailySalt.mock.calls[1]?.[1]).toBe("2026-11-13");
  });

  it("gives the same visitor on one day and another one on the next", async () => {
    const event = { kind: "follow", path: "/" } as const;
    store.getDailySalt
      .mockResolvedValueOnce("salt-day-1")
      .mockResolvedValueOnce("salt-day-2");

    await recordEvent(db, visit(), event, now);
    await recordEvent(db, visit(), event, new Date("2026-11-13T09:00:00Z"));

    const [first, second] = store.insertAnalyticsEvent.mock.calls.map(
      (call) => call[1].visitor,
    );
    expect(first).not.toBe(second);
  });

  it("asks again when another call stored the salt at the same moment", async () => {
    store.getDailySalt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("the-salt");
    await recordEvent(db, visit(), { kind: "follow", path: "/" }, now);
    expect(store.getDailySalt).toHaveBeenCalledTimes(2);
    expect(store.insertAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it("stores nothing when there is no salt, instead of storing a hash of nothing", async () => {
    store.getDailySalt.mockResolvedValue(null);
    await expect(
      recordEvent(db, visit(), { kind: "follow", path: "/" }, now),
    ).rejects.toThrow("salt");
    expect(store.insertAnalyticsEvent).not.toHaveBeenCalled();
  });
});
