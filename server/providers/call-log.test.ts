import { beforeEach, describe, expect, it } from "vitest";

import {
  hasProviderCalls,
  recordProviderCall,
  takeProviderCalls,
} from "./call-log";

const noon = new Date("2026-11-12T12:00:00Z");

beforeEach(() => {
  takeProviderCalls();
});

describe("the count of the calls to the providers (SAG-26)", () => {
  it("adds the calls of a day, provider and outcome into one row", () => {
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: 120 },
      noon,
    );
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 2, ms: 880 },
      noon,
    );

    expect(takeProviderCalls()).toEqual([
      {
        day: "2026-11-12",
        provider: "tmdb",
        outcome: "ok",
        calls: 2,
        requests: 3,
        latencyMs: 1000,
      },
    ]);
  });

  it("keeps a row for each provider, outcome and day", () => {
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: 1 },
      noon,
    );
    recordProviderCall(
      { provider: "mangadex", outcome: "ok", requests: 1, ms: 1 },
      noon,
    );
    recordProviderCall(
      { provider: "tmdb", outcome: "timeout", requests: 3, ms: 1 },
      noon,
    );
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: 1 },
      new Date("2026-11-13T00:00:00Z"),
    );

    expect(takeProviderCalls()).toHaveLength(4);
  });

  it("counts the day in UTC, whatever the zone of the server", () => {
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: 1 },
      new Date("2026-11-12T23:59:59Z"),
    );

    expect(takeProviderCalls()[0]?.day).toBe("2026-11-12");
  });

  it("does not add time for a call that was never sent", () => {
    recordProviderCall(
      { provider: "tmdb", outcome: "circuit_open", requests: 0, ms: 5000 },
      noon,
    );

    expect(takeProviderCalls()[0]).toMatchObject({
      calls: 1,
      requests: 0,
      latencyMs: 0,
    });
  });

  it("never adds a negative or fractional time", () => {
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: -50 },
      noon,
    );
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: 10.6 },
      noon,
    );

    expect(takeProviderCalls()[0]?.latencyMs).toBe(11);
  });

  it("hands everything over once and starts from zero", () => {
    expect(hasProviderCalls()).toBe(false);
    recordProviderCall(
      { provider: "tmdb", outcome: "ok", requests: 1, ms: 1 },
      noon,
    );
    expect(hasProviderCalls()).toBe(true);

    expect(takeProviderCalls()).toHaveLength(1);
    expect(hasProviderCalls()).toBe(false);
    expect(takeProviderCalls()).toEqual([]);
  });
});
