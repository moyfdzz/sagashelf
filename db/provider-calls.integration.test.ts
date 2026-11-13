import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { saveProviderCalls } from "../server/db/provider-calls";
import {
  providerCallsDaily,
  providerOutcomes,
} from "../server/db/schema/providers";
import type { ProviderCallRow } from "../server/providers/call-log";
import { createTestDb } from "./test-database";
import { failsWith } from "./test-helpers";

const { db, pool } = createTestDb();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE provider_calls_daily`);
});

const row = (fields: Partial<ProviderCallRow> = {}): ProviderCallRow => ({
  day: "2026-11-12",
  provider: "tmdb",
  outcome: "ok",
  calls: 2,
  requests: 3,
  latencyMs: 500,
  ...fields,
});

const stored = () =>
  db
    .select()
    .from(providerCallsDaily)
    .orderBy(
      providerCallsDaily.day,
      providerCallsDaily.provider,
      providerCallsDaily.outcome,
    );

describe("saveProviderCalls (SAG-26)", () => {
  it("writes every row in one statement", async () => {
    await saveProviderCalls(db, [
      row(),
      row({ provider: "mangadex", outcome: "http_5xx", calls: 1, requests: 3 }),
      row({ day: "2026-11-13" }),
    ]);

    expect(await stored()).toEqual([
      {
        day: "2026-11-12",
        provider: "mangadex",
        outcome: "http_5xx",
        calls: 1,
        requests: 3,
        latencyMs: 500,
      },
      {
        day: "2026-11-12",
        provider: "tmdb",
        outcome: "ok",
        calls: 2,
        requests: 3,
        latencyMs: 500,
      },
      {
        day: "2026-11-13",
        provider: "tmdb",
        outcome: "ok",
        calls: 2,
        requests: 3,
        latencyMs: 500,
      },
    ]);
  });

  it("adds to the row of the day when another instance already wrote its part", async () => {
    await saveProviderCalls(db, [row()]);
    await saveProviderCalls(db, [
      row({ calls: 5, requests: 5, latencyMs: 250 }),
    ]);

    expect(await stored()).toEqual([
      {
        day: "2026-11-12",
        provider: "tmdb",
        outcome: "ok",
        calls: 7,
        requests: 8,
        latencyMs: 750,
      },
    ]);
  });

  it("does nothing, and sends nothing, for no rows", async () => {
    await saveProviderCalls(db, []);

    expect(await stored()).toEqual([]);
  });

  it("writes every outcome the code can count", async () => {
    await saveProviderCalls(
      db,
      providerOutcomes.map((outcome) => row({ outcome })),
    );

    expect((await stored()).map((r) => r.outcome).sort()).toEqual(
      [...providerOutcomes].sort(),
    );
  });

  it("is refused by the table for an outcome it does not know, a provider with a made-up name or a negative count", async () => {
    const outcome = await failsWith(
      saveProviderCalls(db, [row({ outcome: "exploded" as never })]),
    );
    const name = await failsWith(
      saveProviderCalls(db, [row({ provider: "TMDB; DROP" })]),
    );
    const negative = await failsWith(
      saveProviderCalls(db, [row({ calls: -1 })]),
    );

    expect(outcome.constraint).toBe("provider_calls_daily_outcome_check");
    expect(name.constraint).toBe("provider_calls_daily_provider_check");
    expect(negative.constraint).toBe("provider_calls_daily_counts_check");
    expect(await stored()).toEqual([]);
  });

  it("takes a time in milliseconds that does not fit an int", async () => {
    await saveProviderCalls(db, [row({ latencyMs: 5_000_000_000 })]);

    expect((await stored())[0]?.latencyMs).toBe(5_000_000_000);
  });
});
