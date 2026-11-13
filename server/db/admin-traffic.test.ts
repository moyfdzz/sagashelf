import { describe, expect, it } from "vitest";

import {
  getAdminTraffic,
  parseTrafficDays,
  type TrafficDays,
} from "./admin-traffic";
import type { SqlExecutor } from "./clerk-sync";

const now = new Date("2026-11-12T15:00:00Z");

const answering = (rows: Record<string, unknown>[]): SqlExecutor => ({
  execute: async () => ({ rows }),
});

describe("the window of the traffic (SAG-26)", () => {
  it("accepts only the windows the page offers", () => {
    expect(parseTrafficDays("7")).toBe(7);
    expect(parseTrafficDays("30")).toBe(30);
    expect(parseTrafficDays("90")).toBe(90);
  });

  it("falls back to 30 days for anything else, even what Number would read as an offered one", () => {
    for (const raw of [
      null,
      "",
      "14",
      "30 ",
      " 30",
      "030",
      "07",
      "3e1",
      "-7",
      "7.0",
      "abc",
    ]) {
      expect(parseTrafficDays(raw)).toBe(30);
    }
  });
});

describe("getAdminTraffic (SAG-26)", () => {
  it("reads what the client hands over as text and orders it by what happened", async () => {
    const traffic = await getAdminTraffic(
      answering([
        { part: "rolled", events: "2" },
        {
          part: "total",
          dimension: "kind",
          value: "pageview",
          events: "30",
          visitors: "10",
          engaged_ms: "0",
        },
        {
          part: "total",
          dimension: "kind",
          value: "engaged",
          events: "0",
          visitors: "0",
          engaged_ms: "90000",
        },
        {
          part: "total",
          dimension: "kind",
          value: "signup",
          events: 3,
          visitors: 3,
          engaged_ms: 0,
        },
        {
          part: "total",
          dimension: "referrer_class",
          value: "internal",
          events: 500,
          visitors: 5,
          engaged_ms: 0,
        },
        {
          part: "total",
          dimension: "referrer_class",
          value: "direct",
          events: 4,
          visitors: 4,
          engaged_ms: 0,
        },
        {
          part: "total",
          dimension: "referrer_class",
          value: "search",
          events: 9,
          visitors: 9,
          engaged_ms: 0,
        },
        {
          part: "total",
          dimension: "page",
          value: "/a",
          events: 1,
          visitors: 1,
          engaged_ms: 0,
        },
        {
          part: "total",
          dimension: "page",
          value: "/b",
          events: 5,
          visitors: 2,
          engaged_ms: 0,
        },
        {
          part: "day",
          day: "2026-11-11",
          dimension: "kind",
          value: "pageview",
          events: 20,
          visitors: 6,
          engaged_ms: 0,
        },
        {
          part: "day",
          day: new Date("2026-11-09T00:00:00Z"),
          dimension: "kind",
          value: "pageview",
          events: "10",
          visitors: "4",
          engaged_ms: 0,
        },
      ]),
      now,
      7,
    );

    expect(traffic).toMatchObject({
      days: 7,
      from: "2026-11-05",
      to: "2026-11-11",
      rolledDays: 2,
      pageviews: 30,
      visits: 10,
      engagedMs: 90_000,
    });
    expect(traffic.funnel).toEqual([
      { kind: "pageview", count: 10 },
      { kind: "signup", count: 3 },
      { kind: "add_to_library", count: 0 },
      { kind: "follow", count: 0 },
    ]);
    expect(traffic.sources.map((row) => row.value)).toEqual([
      "search",
      "direct",
    ]);
    expect(traffic.pages.map((row) => row.value)).toEqual(["/b", "/a"]);
    expect(traffic.perDay).toHaveLength(7);
    expect(traffic.perDay[4]).toEqual({
      day: "2026-11-09",
      pageviews: 10,
      visits: 4,
    });
    expect(traffic.perDay[6]).toEqual({
      day: "2026-11-11",
      pageviews: 20,
      visits: 6,
    });
    expect(traffic.perDay[0]).toEqual({
      day: "2026-11-05",
      pageviews: 0,
      visits: 0,
    });
  });

  it("answers with zeros when nothing comes back", async () => {
    const traffic = await getAdminTraffic(answering([]), now, 90);

    expect(traffic).toMatchObject({ pageviews: 0, visits: 0, rolledDays: 0 });
    expect(traffic.perDay).toHaveLength(90);
    expect(traffic.sources).toEqual([]);
  });

  it("asks for the days that end yesterday, in UTC, for each window", async () => {
    const asked: string[] = [];
    for (const days of [7, 30, 90] as TrafficDays[]) {
      await getAdminTraffic(
        {
          execute: async (query) => {
            asked.push(JSON.stringify(query));
            return { rows: [] };
          },
        },
        now,
        days,
      );
    }

    expect(asked[0]).toContain('"2026-11-05"');
    expect(asked[0]).toContain('"2026-11-11"');
    expect(asked[1]).toContain('"2026-10-13"');
    expect(asked[2]).toContain('"2026-08-14"');
    expect(asked.join()).not.toContain("2026-11-12");
  });
});
