import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAdminTraffic, topSize } from "../server/db/admin-traffic";
import { analyticsDaily } from "../server/db/schema";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE analytics_daily`);
});

// The window of 7 days that ends yesterday: 5 to 11 November.
const now = new Date("2026-11-12T15:00:00Z");

type Row = typeof analyticsDaily.$inferInsert;
const row = (
  day: string,
  dimension: string,
  value: string,
  events: number,
  visitors = events,
  engagedMs = 0,
): Row => ({ day, dimension, value, events, visitors, engagedMs });

describe("getAdminTraffic (SAG-26)", () => {
  it("answers with zeros and a full chart when nothing was rolled up", async () => {
    const traffic = await getAdminTraffic(db, now, 7);

    expect(traffic).toMatchObject({
      days: 7,
      from: "2026-11-05",
      to: "2026-11-11",
      rolledDays: 0,
      pageviews: 0,
      visits: 0,
      engagedMs: 0,
      sources: [],
      pages: [],
    });
    expect(traffic.perDay).toHaveLength(7);
    expect(traffic.perDay[0]).toEqual({
      day: "2026-11-05",
      pageviews: 0,
      visits: 0,
    });
    expect(traffic.funnel.map((step) => step.count)).toEqual([0, 0, 0, 0]);
  });

  it("adds the days of the window and leaves out today and the days before it", async () => {
    await db
      .insert(analyticsDaily)
      .values([
        row("2026-11-04", "kind", "pageview", 100, 50),
        row("2026-11-05", "kind", "pageview", 10, 4),
        row("2026-11-11", "kind", "pageview", 20, 6),
        row("2026-11-12", "kind", "pageview", 999, 99),
        row("2026-11-05", "kind", "engaged", 0, 0, 60_000),
        row("2026-11-11", "kind", "engaged", 0, 0, 30_000),
        row("2026-11-11", "kind", "signup", 2, 2),
        row("2026-11-05", "kind", "signup", 1, 1),
        row("2026-11-11", "kind", "add_to_library", 5, 3),
      ]);

    const traffic = await getAdminTraffic(db, now, 7);

    expect(traffic.pageviews).toBe(30);
    expect(traffic.visits).toBe(10);
    expect(traffic.engagedMs).toBe(90_000);
    expect(traffic.rolledDays).toBe(2);
    expect(traffic.funnel).toEqual([
      { kind: "pageview", count: 10 },
      { kind: "signup", count: 3 },
      { kind: "add_to_library", count: 3 },
      { kind: "follow", count: 0 },
    ]);
    expect(traffic.perDay[0]).toEqual({
      day: "2026-11-05",
      pageviews: 10,
      visits: 4,
    });
    expect(traffic.perDay[6]).toEqual({
      day: "2026-11-11",
      pageviews: 20,
      visits: 6,
    });
    expect(traffic.perDay[3]?.pageviews).toBe(0);
  });

  it("ranks sources, devices and pages by what happened, and hides visits from inside the site", async () => {
    await db
      .insert(analyticsDaily)
      .values([
        row("2026-11-10", "referrer_class", "internal", 500),
        row("2026-11-10", "referrer_class", "direct", 12),
        row("2026-11-11", "referrer_class", "direct", 8),
        row("2026-11-11", "referrer_class", "search", 30),
        row("2026-11-11", "referrer_host", "google.com", 25),
        row("2026-11-11", "device", "mobile", 40),
        row("2026-11-11", "device", "desktop", 10),
        row("2026-11-10", "page", "/library", 7),
        row("2026-11-11", "page", "/library", 3),
        row("2026-11-11", "page", "/trending", 9),
      ]);

    const traffic = await getAdminTraffic(db, now, 7);

    expect(traffic.sources).toEqual([
      { value: "search", events: 30, visitors: 30 },
      { value: "direct", events: 20, visitors: 20 },
    ]);
    expect(traffic.hosts).toEqual([
      { value: "google.com", events: 25, visitors: 25 },
    ]);
    expect(traffic.devices.map((d) => d.value)).toEqual(["mobile", "desktop"]);
    expect(traffic.pages).toEqual([
      { value: "/library", events: 10, visitors: 10 },
      { value: "/trending", events: 9, visitors: 9 },
    ]);
  });

  it("keeps only the top pages", async () => {
    await db
      .insert(analyticsDaily)
      .values(
        Array.from({ length: topSize + 5 }, (_, index) =>
          row(
            "2026-11-11",
            "page",
            `/p${String(index).padStart(2, "0")}`,
            100 - index,
          ),
        ),
      );

    const traffic = await getAdminTraffic(db, now, 7);

    expect(traffic.pages).toHaveLength(topSize);
    expect(traffic.pages[0]?.value).toBe("/p00");
  });

  it("leaves the rest of the rollup out of the top pages and sites, so it takes no place", async () => {
    await db
      .insert(analyticsDaily)
      .values([
        row("2026-11-11", "page", "(other)", 900),
        row("2026-11-11", "page", "/library", 3),
        row("2026-11-11", "referrer_host", "(other)", 900),
        row("2026-11-11", "referrer_host", "google.com", 2),
        row("2026-11-11", "device", "(other)", 1),
      ]);

    const traffic = await getAdminTraffic(db, now, 7);

    expect(traffic.pages.map((r) => r.value)).toEqual(["/library"]);
    expect(traffic.hosts.map((r) => r.value)).toEqual(["google.com"]);
    expect(traffic.devices.map((r) => r.value)).toEqual(["(other)"]);
  });

  it("widens the window with the number of days", async () => {
    await db
      .insert(analyticsDaily)
      .values([row("2026-09-14", "kind", "pageview", 7, 7)]);

    expect((await getAdminTraffic(db, now, 30)).pageviews).toBe(0);
    expect((await getAdminTraffic(db, now, 90)).pageviews).toBe(7);
  });
});
