import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAdminOverview, signupDays } from "../server/db/admin-overview";
import { libraryEntries } from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser, newMedia } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE users, media_items RESTART IDENTITY CASCADE`);
});

const now = new Date("2026-11-12T15:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("getAdminOverview (SAG-26)", () => {
  it("answers with zeros and a full chart when the site is empty", async () => {
    const overview = await getAdminOverview(db, now);

    expect(overview).toMatchObject({
      totalUsers: 0,
      newToday: 0,
      newLast30Days: 0,
      newLast365Days: 0,
      activeLast7Days: 0,
      activeLast30Days: 0,
      entriesTracked: 0,
      titlesTracked: 0,
    });
    expect(overview.signups).toHaveLength(signupDays);
    expect(overview.signups[0]).toEqual({ day: "2026-10-14", count: 0 });
    expect(overview.signups.at(-1)).toEqual({ day: "2026-11-12", count: 0 });
  });

  it("counts people by the day they joined, in UTC, and leaves out deleted accounts", async () => {
    await newUser({ createdAt: new Date("2026-11-12T00:00:00Z") });
    await newUser({ createdAt: new Date("2026-11-11T23:59:59Z") });
    await newUser({ createdAt: daysAgo(29) });
    await newUser({ createdAt: daysAgo(30) });
    await newUser({ createdAt: daysAgo(364) });
    await newUser({ createdAt: daysAgo(365) });
    await newUser({ createdAt: daysAgo(1), deletedAt: daysAgo(0) });

    const overview = await getAdminOverview(db, now);

    expect(overview.totalUsers).toBe(6);
    expect(overview.newToday).toBe(1);
    expect(overview.newLast30Days).toBe(3);
    expect(overview.newLast365Days).toBe(5);
    expect(overview.signups.find((s) => s.day === "2026-11-12")?.count).toBe(1);
    expect(overview.signups.find((s) => s.day === "2026-11-11")?.count).toBe(1);
    expect(overview.signups.find((s) => s.day === "2026-10-14")?.count).toBe(1);
    expect(overview.signups.reduce((sum, s) => sum + s.count, 0)).toBe(3);
  });

  it("counts a person as active once, by what they changed in the library", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const cy = await newUser();
    const [film, show] = [await newMedia(), await newMedia()];
    const entry = (
      userId: string,
      mediaId: string,
      touched: Date,
    ): typeof libraryEntries.$inferInsert => ({
      userId,
      mediaId,
      createdAt: touched,
      updatedAt: touched,
    });
    await db
      .insert(libraryEntries)
      .values([
        entry(ana.id, film.id, daysAgo(2)),
        entry(ana.id, show.id, daysAgo(3)),
        entry(ben.id, film.id, daysAgo(20)),
        entry(cy.id, film.id, daysAgo(90)),
      ]);

    const overview = await getAdminOverview(db, now);

    expect(overview.activeLast7Days).toBe(1);
    expect(overview.activeLast30Days).toBe(2);
    expect(overview.entriesTracked).toBe(4);
    expect(overview.titlesTracked).toBe(2);
  });

  it("does not count the library of a deleted account", async () => {
    const gone = await newUser({ deletedAt: daysAgo(1) });
    const film = await newMedia();
    await db
      .insert(libraryEntries)
      .values({ userId: gone.id, mediaId: film.id });

    const overview = await getAdminOverview(db, now);

    expect(overview.activeLast7Days).toBe(0);
    expect(overview.entriesTracked).toBe(0);
    expect(overview.titlesTracked).toBe(0);
  });
});
