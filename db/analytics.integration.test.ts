import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getDailySalt,
  insertAnalyticsEvent,
  type NewAnalyticsEvent,
} from "../server/db/analytics";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE analytics_events, analytics_salts`);
});

const visitor = "0123456789abcdef0123456789abcdef";

const event = (fields: Partial<NewAnalyticsEvent> = {}): NewAnalyticsEvent => ({
  kind: "pageview",
  path: "/sagas",
  visitor,
  engagedMs: null,
  searchType: null,
  lcpMs: null,
  cls: null,
  inpMs: null,
  referrerClass: "direct",
  referrerHost: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  country: "MX",
  region: "Mexico City",
  device: "desktop",
  ...fields,
});

const count = async () =>
  Number(
    (await db.execute(sql`SELECT count(*) AS n FROM analytics_events`)).rows[0]
      ?.n,
  );

describe("analytics_events", () => {
  it("stores an event of each kind", async () => {
    await insertAnalyticsEvent(db, event());
    await insertAnalyticsEvent(
      db,
      event({ kind: "engaged", engagedMs: 9000, referrerClass: null }),
    );
    await insertAnalyticsEvent(
      db,
      event({ kind: "search", searchType: "anime", referrerClass: null }),
    );
    await insertAnalyticsEvent(
      db,
      event({ kind: "follow", referrerClass: null }),
    );
    expect(await count()).toBe(4);
  });

  it.each([
    ["an unknown kind", { kind: "keystroke" }],
    ["a path that does not start with a slash", { path: "sagas" }],
    ["an empty path", { path: "" }],
    ["a path over 200 characters", { path: `/${"a".repeat(200)}` }],
    ["a visitor that is not a 32 character hash", { visitor: "203.0.113.7" }],
    ["a visitor in capital letters", { visitor: visitor.toUpperCase() }],
    ["a time on page for a page view", { engagedMs: 100 }],
    ["a time on page below zero", { kind: "engaged", engagedMs: -1 }],
    [
      "a time on page over four hours",
      { kind: "engaged", engagedMs: 14_400_001 },
    ],
    ["a time on page with no time", { kind: "engaged", engagedMs: null }],
    ["a search type for a page view", { searchType: "anime" }],
    ["a search with no type", { kind: "search", searchType: null }],
    ["a referrer class that does not exist", { referrerClass: "email" }],
    ["a device that is not mobile or desktop", { device: "fridge" }],
    ["a country in lowercase", { country: "mx" }],
    ["a country of three letters", { country: "MEX" }],
    ["a host over 100 characters", { referrerHost: "a".repeat(101) }],
    ["a utm value over 100 characters", { utmCampaign: "a".repeat(101) }],
    ["a region over 100 characters", { region: "a".repeat(101) }],
    ["a speed event with none of the three numbers", { kind: "vitals" }],
    ["a load time for a page view", { lcpMs: 1200 }],
    ["a layout shift for a page view", { cls: 0.1 }],
    [
      "an interaction time for a search",
      { kind: "search", searchType: "anime", inpMs: 50 },
    ],
    ["a load time below zero", { kind: "vitals", lcpMs: -1 }],
    ["a load time over a minute", { kind: "vitals", lcpMs: 60_001 }],
    ["an interaction time over a minute", { kind: "vitals", inpMs: 60_001 }],
    ["a layout shift below zero", { kind: "vitals", cls: -0.01 }],
    ["a layout shift over 100", { kind: "vitals", cls: 100.5 }],
  ] as [string, Partial<NewAnalyticsEvent>][])(
    "refuses %s",
    async (_name, fields) => {
      await expect(insertAnalyticsEvent(db, event(fields))).rejects.toThrow();
      expect(await count()).toBe(0);
    },
  );

  it("stores the steps of the funnel with the address of their action", async () => {
    await insertAnalyticsEvent(
      db,
      event({
        kind: "add_to_library",
        path: "/library/add-external",
        referrerClass: null,
      }),
    );
    await insertAnalyticsEvent(
      db,
      event({ kind: "follow", path: "/u/:username", referrerClass: null }),
    );
    expect(await count()).toBe(2);
  });

  it("stores the speed of a page load with any of the three numbers", async () => {
    await insertAnalyticsEvent(
      db,
      event({
        kind: "vitals",
        lcpMs: 1800.5,
        cls: 0.03,
        inpMs: 120,
        referrerClass: null,
      }),
    );
    // Safari has no layout shift, and a visit with no click has no interaction time.
    await insertAnalyticsEvent(
      db,
      event({ kind: "vitals", lcpMs: 2400, referrerClass: null }),
    );
    await insertAnalyticsEvent(
      db,
      event({ kind: "vitals", cls: 0, referrerClass: null }),
    );
    expect(await count()).toBe(3);
  });

  it("has no column for an address, a city or a user", async () => {
    const { rows } = await db.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_events'
    `);
    const names = rows.map((row) => String(row.column_name));
    for (const forbidden of [
      "ip",
      "ip_address",
      "city",
      "user_id",
      "user_agent",
      "query",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

/** A day in UTC, counted from today by the clock of this machine, as `YYYY-MM-DD`. */
const day = (fromToday: number) =>
  new Date(Date.now() + fromToday * 86_400_000).toISOString().slice(0, 10);

const savedDays = async () =>
  (
    await db.execute(
      sql`SELECT day::text AS day FROM analytics_salts ORDER BY day`,
    )
  ).rows.map((row) => row.day);

describe("getDailySalt", () => {
  it("stores the first salt of the day and returns that one to everybody after", async () => {
    expect(await getDailySalt(db, day(0), "first")).toBe("first");
    expect(await getDailySalt(db, day(0), "second")).toBe("first");
    expect(await getDailySalt(db, day(0), "third")).toBe("first");
  });

  it("gives every day its own salt", async () => {
    expect(await getDailySalt(db, day(0), "today")).toBe("today");
    expect(await getDailySalt(db, day(1), "tomorrow")).toBe("tomorrow");
  });

  it("deletes the salts older than yesterday, so an old hash cannot be recomputed", async () => {
    await getDailySalt(db, day(-3), "old");
    await getDailySalt(db, day(-1), "yesterday");
    await getDailySalt(db, day(0), "today");

    expect(await savedDays()).toEqual([day(-1), day(0)]);
  });

  it("prunes by the clock of the database, so a Worker with a wrong clock deletes nothing of today", async () => {
    await getDailySalt(db, day(0), "today");
    await getDailySalt(db, day(-1), "yesterday");

    // A Worker whose clock is a week ahead asks for its own day.
    await getDailySalt(db, day(7), "future");

    expect(await savedDays()).toEqual([day(-1), day(0), day(7)]);
  });

  it("returns one salt to every caller of the same moment", async () => {
    const answers = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((candidate) =>
        getDailySalt(db, day(0), candidate),
      ),
    );
    // A caller that could not see the salt yet is told to ask again, never given another one.
    const given = new Set(answers.filter((salt) => salt !== null));
    expect(given.size).toBe(1);
    expect(await getDailySalt(db, day(0), "late")).toBe([...given][0]);
  });
});
