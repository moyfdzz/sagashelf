import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAdminProviders } from "../server/db/admin-providers";
import { providerCallsDaily } from "../server/db/schema/providers";
import { createTestDb } from "./test-database";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE provider_calls_daily`);
});

// The window of 7 days that ends today: 6 to 12 November.
const now = new Date("2026-11-12T15:00:00Z");

type Row = typeof providerCallsDaily.$inferInsert;
const row = (
  day: string,
  provider: string,
  outcome: string,
  calls: number,
  requests = calls,
  latencyMs = 0,
): Row => ({ day, provider, outcome, calls, requests, latencyMs });

describe("getAdminProviders (SAG-26)", () => {
  it("answers with zeros, no providers and a full chart when nothing was counted", async () => {
    const providers = await getAdminProviders(db, now, 7);

    expect(providers).toMatchObject({
      days: 7,
      from: "2026-11-06",
      to: "2026-11-12",
      startedOn: null,
      providers: [],
      totals: { calls: 0, failed: 0, requests: 0, latencyAvgMs: null },
    });
    expect(providers.perDay).toHaveLength(7);
    expect(providers.perDay[0]).toEqual({
      day: "2026-11-06",
      calls: 0,
      failed: 0,
    });
  });

  it("adds each provider over the window, by how its calls ended", async () => {
    await db.insert(providerCallsDaily).values([
      row("2026-11-11", "tmdb", "ok", 8, 9, 900),
      row("2026-11-12", "tmdb", "ok", 2, 2, 100),
      row("2026-11-12", "tmdb", "http_5xx", 1, 3, 600),
      row("2026-11-12", "tmdb", "circuit_open", 4, 0, 0),
      row("2026-11-12", "mangadex", "ok", 3, 3, 300),
      // Outside the window: before it and tomorrow.
      row("2026-11-05", "tmdb", "ok", 100, 100, 1),
      row("2026-11-13", "tmdb", "ok", 100, 100, 1),
    ]);

    const result = await getAdminProviders(db, now, 7);

    expect(result.providers.map((p) => p.provider)).toEqual([
      "tmdb",
      "mangadex",
    ]);
    const tmdb = result.providers[0];
    expect(tmdb).toMatchObject({
      calls: 15,
      failed: 5,
      stopped: 4,
      requests: 14,
      // 900 + 100 + 600 ms over the 11 calls that sent something.
      peakDayRequests: 9,
    });
    expect(tmdb?.latencyAvgMs).toBeCloseTo(1600 / 11, 5);
    expect(tmdb?.outcomes).toMatchObject({
      ok: 10,
      http_5xx: 1,
      circuit_open: 4,
      timeout: 0,
    });
    expect(result.totals).toMatchObject({ calls: 18, failed: 5, requests: 17 });
    expect(result.totals.latencyAvgMs).toBeCloseTo(1900 / 14, 5);
    expect(result.totals.outcomes.ok).toBe(13);
  });

  it("gives the calls and the failed calls of each day, and the first day anything was counted", async () => {
    await db
      .insert(providerCallsDaily)
      .values([
        row("2026-11-10", "tmdb", "ok", 5),
        row("2026-11-10", "tmdb", "timeout", 2),
        row("2026-11-10", "mangadex", "http_429", 1),
        row("2026-11-12", "tmdb", "ok", 1),
        row("2026-09-01", "tmdb", "ok", 1),
      ]);

    const result = await getAdminProviders(db, now, 7);

    const byDay = Object.fromEntries(
      result.perDay.map((d) => [d.day, [d.calls, d.failed]]),
    );
    expect(byDay["2026-11-10"]).toEqual([8, 3]);
    expect(byDay["2026-11-12"]).toEqual([1, 0]);
    expect(byDay["2026-11-11"]).toEqual([0, 0]);
    expect(result.startedOn).toBe("2026-09-01");
  });

  it("does not count an answer of 4xx or a call the app cancelled as failed, in the totals or in the day", async () => {
    await db
      .insert(providerCallsDaily)
      .values([
        row("2026-11-12", "tmdb", "ok", 4, 4, 400),
        row("2026-11-12", "tmdb", "http_4xx", 3, 3, 300),
        row("2026-11-12", "tmdb", "cancelled", 2, 2, 2000),
        row("2026-11-12", "tmdb", "timeout", 1, 3, 3000),
      ]);

    const result = await getAdminProviders(db, now, 7);

    expect(result.providers[0]).toMatchObject({
      calls: 10,
      failed: 1,
      stopped: 0,
    });
    expect(result.perDay.at(-1)).toEqual({
      day: "2026-11-12",
      calls: 10,
      failed: 1,
    });
    // The cancelled and the 4xx calls count for the average time: 5700 ms over 10 calls.
    expect(result.providers[0]?.latencyAvgMs).toBeCloseTo(570, 5);
  });

  it("has no average time for a provider whose calls were all never sent", async () => {
    await db
      .insert(providerCallsDaily)
      .values([row("2026-11-12", "wikidata", "rate_limited", 3, 0, 0)]);

    const result = await getAdminProviders(db, now, 7);

    expect(result.providers[0]).toMatchObject({
      provider: "wikidata",
      calls: 3,
      failed: 3,
      stopped: 3,
      requests: 0,
      latencyAvgMs: null,
    });
  });

  it("widens the window with the number of days", async () => {
    await db
      .insert(providerCallsDaily)
      .values([row("2026-09-14", "tmdb", "ok", 6)]);

    expect((await getAdminProviders(db, now, 30)).totals.calls).toBe(0);
    expect((await getAdminProviders(db, now, 90)).totals.calls).toBe(6);
  });
});
