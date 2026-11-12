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
  ] as [string, Partial<NewAnalyticsEvent>][])(
    "refuses %s",
    async (_name, fields) => {
      await expect(insertAnalyticsEvent(db, event(fields))).rejects.toThrow();
      expect(await count()).toBe(0);
    },
  );

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

describe("getDailySalt", () => {
  it("stores the first salt of the day and returns that one to everybody after", async () => {
    expect(await getDailySalt(db, "2026-11-12", "first")).toBe("first");
    expect(await getDailySalt(db, "2026-11-12", "second")).toBe("first");
    expect(await getDailySalt(db, "2026-11-12", "third")).toBe("first");
  });

  it("gives every day its own salt", async () => {
    expect(await getDailySalt(db, "2026-11-12", "monday")).toBe("monday");
    expect(await getDailySalt(db, "2026-11-13", "tuesday")).toBe("tuesday");
  });

  it("deletes the salts older than yesterday, so an old hash cannot be recomputed", async () => {
    await getDailySalt(db, "2026-11-10", "old");
    await getDailySalt(db, "2026-11-11", "yesterday");
    await getDailySalt(db, "2026-11-12", "today");

    const { rows } = await db.execute(
      sql`SELECT day::text AS day FROM analytics_salts ORDER BY day`,
    );
    expect(rows.map((row) => row.day)).toEqual(["2026-11-11", "2026-11-12"]);
  });

  it("returns one salt to every caller of the same moment", async () => {
    const answers = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((candidate) =>
        getDailySalt(db, "2026-11-12", candidate),
      ),
    );
    // A caller that could not see the salt yet is told to ask again, never given another one.
    const given = new Set(answers.filter((salt) => salt !== null));
    expect(given.size).toBe(1);
    expect(await getDailySalt(db, "2026-11-12", "late")).toBe([...given][0]);
  });
});
