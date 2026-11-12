import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  pruneAnalyticsEvents,
  rollUpAnalytics,
} from "../server/db/analytics-rollup";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE analytics_events, analytics_daily`);
});

type Fields = {
  kind?: string;
  path?: string;
  visitor?: string;
  engagedMs?: number | null;
  searchType?: string | null;
  referrerClass?: string | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  country?: string | null;
  region?: string | null;
  device?: string | null;
};

const visitorOf = (name: string) =>
  name
    .padEnd(32, "0")
    .replace(/[^0-9a-f]/g, "a")
    .slice(0, 32);

/** Stores an event at noon UTC, `daysAgo` days before today (UTC). */
async function event(daysAgo: number, fields: Fields = {}) {
  const f = { kind: "pageview", path: "/", visitor: "a", ...fields };
  await db.execute(sql`
    INSERT INTO analytics_events (
      occurred_at, kind, path, visitor, engaged_ms, search_type, referrer_class, referrer_host,
      utm_source, country, region, device
    ) VALUES (
      ((date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => ${daysAgo}::int)
        + interval '12 hours') AT TIME ZONE 'UTC'),
      ${f.kind}, ${f.path}, ${visitorOf(f.visitor)}, ${f.engagedMs ?? null}, ${f.searchType ?? null},
      ${f.referrerClass ?? null}, ${f.referrerHost ?? null}, ${f.utmSource ?? null},
      ${f.country ?? null}, ${f.region ?? null}, ${f.device ?? null}
    )
  `);
}

type Row = {
  day: string;
  dimension: string;
  value: string;
  events: number;
  visitors: number;
  engaged_ms: number;
};

async function rows(where = sql`true`): Promise<Row[]> {
  const result = await db.execute(sql`
    SELECT day::text AS day, dimension, value, events, visitors, engaged_ms::int AS engaged_ms
    FROM analytics_daily WHERE ${where} ORDER BY day, dimension, value
  `);
  return result.rows as unknown as Row[];
}

const cell = async (dimension: string, value: string) => {
  const found = (
    await rows(sql`dimension = ${dimension} AND value = ${value}`)
  )[0];
  return (
    found && {
      events: found.events,
      visitors: found.visitors,
      engagedMs: found.engaged_ms,
    }
  );
};

const dayOf = async (daysAgo: number) =>
  String(
    (
      await db.execute(
        sql`SELECT ((now() AT TIME ZONE 'UTC')::date - ${daysAgo}::int)::text AS day`,
      )
    ).rows[0]?.day,
  );

describe("rollUpAnalytics: the counts of a finished day", () => {
  beforeEach(async () => {
    await event(3, {
      path: "/",
      visitor: "a",
      referrerClass: "direct",
      country: "MX",
      region: "Mexico City",
      device: "mobile",
      utmSource: "news",
    });
    await event(3, {
      path: "/",
      visitor: "a",
      referrerClass: "direct",
      country: "MX",
      region: "Mexico City",
      device: "mobile",
    });
    await event(3, {
      path: "/sagas",
      visitor: "b",
      referrerClass: "search",
      referrerHost: "google.com",
      country: "US",
      device: "desktop",
    });
    await event(3, {
      kind: "engaged",
      path: "/",
      visitor: "a",
      engagedMs: 5000,
      country: "MX",
      region: "Mexico City",
      device: "mobile",
    });
    await event(3, {
      kind: "engaged",
      path: "/",
      visitor: "b",
      engagedMs: 3000,
      country: "US",
      device: "desktop",
    });
    await event(3, {
      kind: "search",
      path: "/search",
      visitor: "a",
      searchType: "anime",
      country: "MX",
    });
    await event(3, { kind: "follow", path: "/u/:username", visitor: "b" });
  });

  it("rolls the day up and says how much it did", async () => {
    const summary = await rollUpAnalytics(db);

    expect(summary.days).toBe(1);
    expect(summary.rows).toBe((await rows()).length);
    expect(summary.rows).toBeGreaterThan(0);
  });

  it("counts what a person did by kind, with the distinct visitors, and the visible time apart", async () => {
    await rollUpAnalytics(db);

    expect(await cell("kind", "pageview")).toEqual({
      events: 3,
      visitors: 2,
      engagedMs: 0,
    });
    expect(await cell("kind", "search")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("kind", "follow")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    // A time on a page is not something a person did: it has no events, only the milliseconds.
    expect(await cell("kind", "engaged")).toEqual({
      events: 0,
      visitors: 0,
      engagedMs: 8000,
    });
  });

  it("counts the pages: views, visitors and the time", async () => {
    await rollUpAnalytics(db);

    expect(await cell("page", "/")).toEqual({
      events: 2,
      visitors: 1,
      engagedMs: 8000,
    });
    expect(await cell("page", "/sagas")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    // A search and a step of the funnel are not page views of their own address.
    expect(await cell("page", "/search")).toBeUndefined();
    expect(await cell("page", "/u/:username")).toBeUndefined();
  });

  it("counts the sources, the places and the devices of the visits", async () => {
    await rollUpAnalytics(db);

    expect(await cell("referrer_class", "direct")).toEqual({
      events: 2,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("referrer_class", "search")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("referrer_host", "google.com")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("utm_source", "news")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("country", "MX")).toEqual({
      events: 2,
      visitors: 1,
      engagedMs: 5000,
    });
    expect(await cell("country", "US")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 3000,
    });
    expect(await cell("region", "Mexico City")).toEqual({
      events: 2,
      visitors: 1,
      engagedMs: 5000,
    });
    expect(await cell("device", "mobile")).toEqual({
      events: 2,
      visitors: 1,
      engagedMs: 5000,
    });
    expect(await cell("device", "desktop")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 3000,
    });
  });

  it("counts a search by its type, and does not count a search as a visit of its country", async () => {
    await rollUpAnalytics(db);

    expect(await cell("search_type", "anime")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    // The search of the visitor `a` came from MX, and the country counts visits only.
    expect(await cell("country", "MX")).toMatchObject({ events: 2 });
  });

  it("puts every row under the day it happened", async () => {
    await rollUpAnalytics(db);

    const days = new Set((await rows()).map((row) => row.day));
    expect([...days]).toEqual([await dayOf(3)]);
  });
});

describe("rollUpAnalytics: which days", () => {
  it("does nothing when there is nothing to roll up", async () => {
    expect(await rollUpAnalytics(db)).toEqual({ days: 0, rows: 0 });
    expect(await rows()).toEqual([]);
  });

  it("rolls up yesterday and never the day of today, which is not over", async () => {
    await event(0);
    await event(1);

    expect((await rollUpAnalytics(db)).days).toBe(1);

    const days = new Set((await rows()).map((row) => row.day));
    expect([...days]).toEqual([await dayOf(1)]);
  });

  it("does the same thing when it runs again, and touches no day twice", async () => {
    await event(2);
    await event(2, { visitor: "b" });

    await rollUpAnalytics(db);
    const first = await rows();
    const again = await rollUpAnalytics(db);

    expect(again).toEqual({ days: 0, rows: 0 });
    expect(await rows()).toEqual(first);
  });

  it("rolls up a day that is older than the last one done and was never rolled up", async () => {
    await event(2);
    await rollUpAnalytics(db);

    // Events for an older day (a restore or a backfill): not skipped because a later day is done.
    await event(6);
    await event(6, { visitor: "b" });
    const summary = await rollUpAnalytics(db);

    expect(summary.days).toBe(1);
    const old = await rows(
      sql`dimension = 'kind' AND value = 'pageview' AND day = ${await dayOf(6)}::date`,
    );
    expect(old).toMatchObject([{ events: 2, visitors: 2 }]);
    expect((await rows(sql`dimension = 'kind'`)).map((row) => row.day)).toEqual(
      [await dayOf(6), await dayOf(2)],
    );
  });

  it("leaves a day alone once it is rolled up, so what was said does not change", async () => {
    await event(2);
    await rollUpAnalytics(db);
    const first = await rows();

    await event(2, { visitor: "c" });
    await rollUpAnalytics(db);

    expect(await rows()).toEqual(first);
  });

  it("rolls the oldest days first and only a few at a time, so it catches up after a stop", async () => {
    for (const daysAgo of [9, 8, 7, 6, 5]) await event(daysAgo);

    expect((await rollUpAnalytics(db, { days: 2 })).days).toBe(2);
    expect([...new Set((await rows()).map((row) => row.day))]).toEqual([
      await dayOf(9),
      await dayOf(8),
    ]);

    expect((await rollUpAnalytics(db, { days: 2 })).days).toBe(2);
    expect((await rollUpAnalytics(db, { days: 2 })).days).toBe(1);
    expect((await rollUpAnalytics(db, { days: 2 })).days).toBe(0);
    expect(new Set((await rows()).map((row) => row.day)).size).toBe(5);
  });

  it("skips a day with no events and rolls the ones around it", async () => {
    await event(5);
    await event(3);

    expect((await rollUpAnalytics(db)).days).toBe(2);
  });
});

describe("rollUpAnalytics: a flood of values", () => {
  it("keeps the most common values of a dimension and one row for the rest, with their own visitors", async () => {
    for (let i = 0; i < 3; i += 1) {
      await event(2, { utmSource: "big", visitor: "a" });
    }
    for (let i = 0; i < 105; i += 1) {
      await event(2, {
        utmSource: `v${String(i).padStart(3, "0")}`,
        visitor: `${i.toString(16)}b`,
      });
    }

    await rollUpAnalytics(db);

    const kept = await rows(sql`dimension = 'utm_source'`);
    // 106 values: 100 kept, and the 6 of one view each in one row.
    expect(kept).toHaveLength(101);
    expect(await cell("utm_source", "big")).toEqual({
      events: 3,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("utm_source", "(other)")).toEqual({
      events: 6,
      visitors: 6,
      engagedMs: 0,
    });
    // Nothing is lost: the events of the dimension add up to the ones that came in.
    expect(kept.reduce((sum, row) => sum + row.events, 0)).toBe(108);
  });

  it("takes the first of equal values by their name, so the result does not change from run to run", async () => {
    for (const value of ["c", "a", "b"]) await event(2, { utmSource: value });

    await rollUpAnalytics(db, { values: 2 });

    // Sorted here: how a database sorts a parenthesis depends on its collation.
    const kept = (await rows(sql`dimension = 'utm_source'`))
      .map((row) => row.value)
      .sort();
    expect(kept).toEqual(["(other)", "a", "b"].sort());
    expect(await cell("utm_source", "(other)")).toMatchObject({ events: 1 });
  });

  it("does not meet a real value that is called (other) with the row of the rest", async () => {
    await event(2, { utmSource: "a" });
    await event(2, { utmSource: "a" });
    await event(2, { utmSource: "(other)" });
    await event(2, { utmSource: "z" });

    // Both of the last two fall into the rest, and a real "(other)" would collide with it.
    await expect(rollUpAnalytics(db, { values: 1 })).resolves.toMatchObject({
      days: 1,
    });
    expect(await cell("utm_source", "(other)")).toEqual({
      events: 2,
      visitors: 1,
      engagedMs: 0,
    });

    // And when it is kept on its own, it is stored with a space after it.
    await db.execute(sql`TRUNCATE analytics_daily`);
    await rollUpAnalytics(db, { values: 5 });
    expect(await cell("utm_source", "(other) ")).toEqual({
      events: 1,
      visitors: 1,
      engagedMs: 0,
    });
    expect(await cell("utm_source", "(other)")).toBeUndefined();
  });
});

describe("analytics_daily", () => {
  const insert = (fields: Partial<Row> = {}) => {
    const f = {
      day: "2026-01-01",
      dimension: "kind",
      value: "pageview",
      events: 1,
      visitors: 1,
      engaged_ms: 0,
      ...fields,
    };
    return db.execute(sql`
      INSERT INTO analytics_daily (day, dimension, value, events, visitors, engaged_ms)
      VALUES (${f.day}::date, ${f.dimension}, ${f.value}, ${f.events}, ${f.visitors}, ${f.engaged_ms})
    `);
  };

  it("takes a row, and refuses the same day, dimension and value twice", async () => {
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it.each([
    ["a dimension that does not exist", { dimension: "city" }],
    ["a value over 200 characters", { value: "a".repeat(201) }],
    ["a negative number of events", { events: -1 }],
    ["a negative number of visitors", { visitors: -1 }],
    ["a negative time", { engaged_ms: -1 }],
  ] as [string, Partial<Row>][])("refuses %s", async (_name, fields) => {
    await expect(insert(fields)).rejects.toThrow();
  });
});

describe("pruneAnalyticsEvents", () => {
  const count = async () =>
    Number(
      (await db.execute(sql`SELECT count(*) AS n FROM analytics_events`))
        .rows[0]?.n,
    );

  it("deletes the salts older than yesterday even when nobody came and there is nothing else to delete", async () => {
    await db.execute(sql`TRUNCATE analytics_salts`);
    for (const daysAgo of [9, 2, 1, 0]) {
      await db.execute(sql`
        INSERT INTO analytics_salts (day, salt)
        VALUES (((now() AT TIME ZONE 'UTC')::date - ${daysAgo}::int), ${`salt-${daysAgo}`})
      `);
    }

    expect(await pruneAnalyticsEvents(db)).toBe(0);

    const left = await db.execute(
      sql`SELECT salt FROM analytics_salts ORDER BY day`,
    );
    expect(left.rows.map((row) => row.salt)).toEqual(["salt-1", "salt-0"]);
  });

  it("deletes what is older than 13 months and was rolled up, and keeps the rest", async () => {
    await event(430);
    await event(430, { visitor: "b" });
    await event(300);
    await event(2);
    await rollUpAnalytics(db, { days: 10 });
    // An old event that was never rolled up (it came after): it must stay.
    await event(460);

    expect(await pruneAnalyticsEvents(db)).toBe(2);

    expect(await count()).toBe(3);
  });

  it("never deletes an event of a day that was not rolled up, so a stuck rollup loses nothing", async () => {
    await event(500);
    await event(501);

    expect(await pruneAnalyticsEvents(db)).toBe(0);
    expect(await count()).toBe(2);
  });

  it("keeps the rollups when the raw events are gone", async () => {
    await event(430);
    await rollUpAnalytics(db);
    const before = await rows();

    await pruneAnalyticsEvents(db);

    expect(await count()).toBe(0);
    expect(await rows()).toEqual(before);
  });

  it("takes a batch at a time, oldest first", async () => {
    for (const daysAgo of [440, 441, 442]) await event(daysAgo);
    await rollUpAnalytics(db, { days: 10 });

    expect(await pruneAnalyticsEvents(db, { batch: 2 })).toBe(2);
    expect(await count()).toBe(1);
    // The newest of the three is the one left.
    const left = await db.execute(
      sql`SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS day FROM analytics_events`,
    );
    expect(left.rows[0]?.day).toBe(await dayOf(440));

    expect(await pruneAnalyticsEvents(db, { batch: 2 })).toBe(1);
    expect(await pruneAnalyticsEvents(db, { batch: 2 })).toBe(0);
  });
});
