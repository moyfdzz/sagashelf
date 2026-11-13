import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAdminContent } from "../server/db/admin-content";
import {
  analyticsDaily,
  sagas,
  sagaWikidataMembers,
  wikidataItems,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE analytics_daily, sagas, wikidata_items, media_items RESTART IDENTITY CASCADE`,
  );
});

// The window of 7 days that ends yesterday: 5 to 11 November.
const now = new Date("2026-11-12T15:00:00Z");

const search = (day: string, value: string, events: number) => ({
  day,
  dimension: "search_type",
  value,
  events,
  visitors: events,
  engagedMs: 0,
});

describe("getAdminContent (SAG-26)", () => {
  it("answers with zeros and no searches on an empty site", async () => {
    const content = await getAdminContent(db, now, 7);

    expect(content).toEqual({
      days: 7,
      from: "2026-11-05",
      to: "2026-11-11",
      rolledDays: 0,
      searches: [],
      customTotal: 0,
      customNew: 0,
      sagasPublished: 0,
      sagasDraft: 0,
      sagasEmpty: 0,
      works: 0,
      worksDescribed: 0,
    });
  });

  it("adds the searches of the window by type and leaves out today and the days before", async () => {
    await db.insert(analyticsDaily).values([
      search("2026-11-04", "movie", 100),
      search("2026-11-05", "movie", 3),
      search("2026-11-11", "movie", 4),
      search("2026-11-11", "anime", 9),
      search("2026-11-12", "anime", 500),
      {
        day: "2026-11-11",
        dimension: "device",
        value: "mobile",
        events: 77,
        visitors: 77,
        engagedMs: 0,
      },
    ]);

    const content = await getAdminContent(db, now, 7);

    expect(content.searches).toEqual([
      { type: "anime", searches: 9 },
      { type: "movie", searches: 7 },
    ]);
  });

  it("leaves the rest of the rollup out of the searches and counts the days that have data", async () => {
    await db.insert(analyticsDaily).values([
      search("2026-11-10", "movie", 2),
      search("2026-11-10", "(other)", 50),
      search("2026-11-10", "(other) ", 50),
      {
        day: "2026-11-10",
        dimension: "kind",
        value: "pageview",
        events: 1,
        visitors: 1,
        engagedMs: 0,
      },
      {
        day: "2026-11-11",
        dimension: "kind",
        value: "pageview",
        events: 1,
        visitors: 1,
        engagedMs: 0,
      },
      {
        day: "2026-11-12",
        dimension: "kind",
        value: "pageview",
        events: 1,
        visitors: 1,
        engagedMs: 0,
      },
    ]);

    const content = await getAdminContent(db, now, 7);

    expect(content.searches).toEqual([{ type: "movie", searches: 2 }]);
    expect(content.rolledDays).toBe(2);
  });

  it("counts the titles written by hand, and the ones made inside the window", async () => {
    await newMedia({ type: "custom", title: "Old" });
    const recent = await newMedia({ type: "custom", title: "Recent" });
    await newMedia({ type: "movie", title: "Not custom" });
    await db.execute(
      sql`UPDATE media_items SET created_at = '2026-10-01T10:00:00Z' WHERE title = 'Old'`,
    );
    await db.execute(
      sql`UPDATE media_items SET created_at = '2026-11-11T23:59:00Z' WHERE id = ${recent.id}`,
    );
    await newMedia({ type: "custom", title: "Today" });
    await db.execute(
      sql`UPDATE media_items SET created_at = '2026-11-12T01:00:00Z' WHERE title = 'Today'`,
    );

    const content = await getAdminContent(db, now, 7);

    expect(content.customTotal).toBe(3);
    expect(content.customNew).toBe(1);
  });

  it("measures how much of the published sagas is filled in", async () => {
    const made = await db
      .insert(sagas)
      .values([
        { slug: "full", title: "Full", status: "published" },
        { slug: "empty", title: "Empty", status: "published" },
        { slug: "draft", title: "Draft", status: "draft" },
      ])
      .returning({ id: sagas.id, slug: sagas.slug });
    const idOf = (slug: string) => {
      const row = made.find((saga) => saga.slug === slug);
      if (!row) throw new Error(`The saga ${slug} was not created`);
      return row.id;
    };
    await db
      .insert(wikidataItems)
      .values([
        { qid: "Q1", detailsAt: new Date() },
        { qid: "Q2" },
        { qid: "Q3", detailsAt: new Date() },
      ]);
    await db.insert(sagaWikidataMembers).values([
      { sagaId: idOf("full"), qid: "Q1", position: 0 },
      { sagaId: idOf("full"), qid: "Q2", position: 1 },
      // The works of a draft are not counted: a visitor does not see them.
      { sagaId: idOf("draft"), qid: "Q3", position: 0 },
    ]);

    const content = await getAdminContent(db, now, 7);

    expect(content).toMatchObject({
      sagasPublished: 2,
      sagasDraft: 1,
      sagasEmpty: 1,
      works: 2,
      worksDescribed: 1,
    });
  });

  it("widens the window with the number of days", async () => {
    await db.insert(analyticsDaily).values([search("2026-09-14", "book", 6)]);

    expect((await getAdminContent(db, now, 30)).searches).toEqual([]);
    expect((await getAdminContent(db, now, 90)).searches).toEqual([
      { type: "book", searches: 6 },
    ]);
  });
});
