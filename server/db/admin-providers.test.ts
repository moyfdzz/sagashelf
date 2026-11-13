import { describe, expect, it } from "vitest";

import { getAdminProviders } from "./admin-providers";
import type { SqlExecutor } from "./clerk-sync";
import { providerOutcomes } from "./schema/providers";

const now = new Date("2026-11-12T15:00:00Z");

const answering = (rows: Record<string, unknown>[]): SqlExecutor => ({
  execute: async () => ({ rows }),
});

const total = (
  provider: string,
  outcome: string,
  calls: unknown,
  requests: unknown = calls,
  latency: unknown = 0,
) => ({
  part: "total",
  day: null,
  provider,
  outcome,
  calls,
  requests,
  latency_ms: latency,
});

describe("getAdminProviders (SAG-26)", () => {
  it("adds the outcomes of each provider and works out the failed calls and the average time", async () => {
    const result = await getAdminProviders(
      answering([
        total("tmdb", "ok", "8", "9", "900"),
        total("tmdb", "http_5xx", 1, 3, 600),
        total("tmdb", "circuit_open", 4, 0, 0),
        total("mangadex", "ok", 3, 3, 300),
        { part: "peak", provider: "tmdb", requests: "9" },
        { part: "peak", provider: "mangadex", requests: 3 },
        { part: "first", day: "2026-09-01" },
      ]),
      now,
      7,
    );

    expect(result.providers.map((p) => p.provider)).toEqual([
      "tmdb",
      "mangadex",
    ]);
    expect(result.providers[0]).toMatchObject({
      calls: 13,
      failed: 5,
      stopped: 4,
      requests: 12,
      peakDayRequests: 9,
    });
    expect(result.providers[0]?.latencyAvgMs).toBeCloseTo(1500 / 9, 5);
    expect(result.providers[0]?.outcomes.ok).toBe(8);
    expect(result.totals).toMatchObject({ calls: 16, failed: 5, requests: 15 });
    expect(result.totals.latencyAvgMs).toBeCloseTo(1800 / 12, 5);
    expect(result.startedOn).toBe("2026-09-01");
  });

  it("does not count as a failure an answer of 4xx or a call the app cancelled", async () => {
    const result = await getAdminProviders(
      answering([
        total("tmdb", "ok", 5),
        total("tmdb", "http_4xx", 3),
        total("tmdb", "cancelled", 2),
        total("tmdb", "http_429", 1),
        total("tmdb", "timeout", 1),
      ]),
      now,
      7,
    );

    expect(result.providers[0]).toMatchObject({
      calls: 12,
      failed: 2,
      stopped: 0,
    });
    expect(result.totals.failed).toBe(2);
    expect(result.providers[0]?.outcomes.cancelled).toBe(2);
  });

  it("has every outcome the code counts in the totals, with zero for the ones with no calls", async () => {
    const result = await getAdminProviders(answering([]), now, 7);

    expect(Object.keys(result.totals.outcomes)).toEqual([...providerOutcomes]);
    expect(Object.values(result.totals.outcomes).every((n) => n === 0)).toBe(
      true,
    );
  });

  it("leaves out an outcome it does not know, and a provider with no calls", async () => {
    const result = await getAdminProviders(
      answering([
        total("tmdb", "ok", 2),
        total("tmdb", "exploded", 99),
        total("ghost", "ok", 0),
      ]),
      now,
      7,
    );

    expect(result.providers.map((p) => p.provider)).toEqual(["tmdb"]);
    expect(result.providers[0]?.calls).toBe(2);
  });

  it("has no average time when no call was sent, and none when nothing comes back", async () => {
    const stopped = await getAdminProviders(
      answering([total("tmdb", "rate_limited", 3, 0, 0)]),
      now,
      7,
    );
    const empty = await getAdminProviders(answering([]), now, 30);

    expect(stopped.providers[0]?.latencyAvgMs).toBeNull();
    expect(stopped.totals.latencyAvgMs).toBeNull();
    expect(empty).toMatchObject({
      from: "2026-10-14",
      to: "2026-11-12",
      startedOn: null,
      providers: [],
    });
    expect(empty.perDay).toHaveLength(30);
  });

  it("gives a row for every day, reading the days as text or as a Date, and skipping one that is not a day", async () => {
    const result = await getAdminProviders(
      answering([
        { part: "day", day: "2026-11-12", calls: "5", failed: "2" },
        {
          part: "day",
          day: new Date("2026-11-10T00:00:00Z"),
          calls: 3,
          failed: 1,
        },
        { part: "day", day: "undefined", calls: 99, failed: 99 },
      ]),
      now,
      7,
    );

    const byDay = Object.fromEntries(
      result.perDay.map((d) => [d.day, [d.calls, d.failed]]),
    );
    expect(result.perDay).toHaveLength(7);
    expect(byDay["2026-11-12"]).toEqual([5, 2]);
    expect(byDay["2026-11-10"]).toEqual([3, 1]);
    expect(byDay["2026-11-11"]).toEqual([0, 0]);
  });

  it("reads numbers that are not numbers as zero", async () => {
    const result = await getAdminProviders(
      answering([total("tmdb", "ok", "abc", "x", "y")]),
      now,
      7,
    );

    expect(result.providers).toEqual([]);
    expect(result.totals.calls).toBe(0);
  });

  it("asks for whole days of UTC that end today", async () => {
    const asked: string[] = [];
    await getAdminProviders(
      {
        execute: async (query) => {
          asked.push(JSON.stringify(query));
          return { rows: [] };
        },
      },
      now,
      7,
    );

    expect(asked[0]).toContain('"2026-11-06"');
    expect(asked[0]).toContain('"2026-11-12"');
  });
});
