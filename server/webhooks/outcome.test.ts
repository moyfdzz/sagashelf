import { describe, expect, it } from "vitest";

import {
  backoffMs,
  decide,
  disableAfterFailures,
  maxAttempts,
  maxRetryAfterMs,
  retryDelaysMs,
  type AttemptResult,
} from "./outcome";

const answer = (
  status: number | null,
  extra: Partial<AttemptResult> = {},
): AttemptResult => ({ status, error: null, retryAfterMs: null, ...extra });

// A random number that is always the middle: no spread.
const middle = () => 0.5;

describe("backoffMs (SAG-27)", () => {
  it("waits 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, with no spread at the middle", () => {
    expect(
      [1, 2, 3, 4, 5].map((attempt) => backoffMs(attempt, middle)),
    ).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(retryDelaysMs).toHaveLength(5);
  });

  it("spreads each wait by 20% either way, so events that failed together do not return together", () => {
    for (const [attempt, base] of retryDelaysMs.entries()) {
      expect(backoffMs(attempt + 1, () => 0)).toBe(Math.round(base * 0.8));
      expect(backoffMs(attempt + 1, () => 1)).toBe(Math.round(base * 1.2));
    }
  });

  it("has no wait after the last try, and none before the first", () => {
    expect(backoffMs(maxAttempts)).toBeNull();
    expect(backoffMs(0)).toBeNull();
    expect(maxAttempts).toBe(6);
  });
});

describe("decide (SAG-27)", () => {
  it("delivers on any 2xx", () => {
    for (const status of [200, 201, 204, 299]) {
      expect(decide(answer(status), 1)).toEqual({ kind: "delivered" });
    }
  });

  describe("a 429", () => {
    it("waits what Discord asked and does not count against the endpoint", () => {
      expect(decide(answer(429, { retryAfterMs: 12_500 }), 1)).toEqual({
        kind: "retry",
        delayMs: 12_500,
        countFailure: false,
        error: "http_429",
      });
    });

    it("uses the normal wait when Discord did not say how long", () => {
      expect(decide(answer(429), 2, middle)).toMatchObject({
        kind: "retry",
        delayMs: 300_000,
        countFailure: false,
      });
    });

    it("never retries sooner than a second, and never makes a person wait more than 12 hours", () => {
      expect(decide(answer(429, { retryAfterMs: 0 }), 1)).toMatchObject({
        delayMs: 1_000,
      });
      expect(
        decide(answer(429, { retryAfterMs: 5 * maxRetryAfterMs }), 1),
      ).toMatchObject({ delayMs: maxRetryAfterMs });
    });

    it("gives up on the last try, still without blaming the endpoint", () => {
      expect(decide(answer(429, { retryAfterMs: 1_000 }), maxAttempts)).toEqual(
        {
          kind: "failed",
          countFailure: false,
          disable: null,
          error: "http_429",
        },
      );
    });
  });

  describe("an answer that says the endpoint is no good", () => {
    it.each([401, 403])(
      "turns it off at once for a %s, as unauthorized",
      (status) => {
        expect(decide(answer(status), 1)).toEqual({
          kind: "failed",
          countFailure: false,
          disable: "unauthorized",
          error: `http_${status}`,
        });
      },
    );

    it.each([404, 410])(
      "turns it off at once for a %s, as not found",
      (status) => {
        expect(decide(answer(status), 3)).toEqual({
          kind: "failed",
          countFailure: false,
          disable: "not_found",
          error: `http_${status}`,
        });
      },
    );
  });

  it("does not retry another 4xx: the same message would be refused again, and it counts as a failure", () => {
    for (const status of [400, 413, 422]) {
      expect(decide(answer(status), 1)).toEqual({
        kind: "failed",
        countFailure: true,
        disable: null,
        error: `http_${status}`,
      });
    }
  });

  it("does not follow or retry a redirect", () => {
    for (const status of [301, 302, 307, 308]) {
      expect(decide(answer(status), 1)).toEqual({
        kind: "failed",
        countFailure: true,
        disable: null,
        error: "redirect",
      });
    }
  });

  describe("a 5xx, no answer and a timeout", () => {
    const cases: [string, AttemptResult, string][] = [
      ["a 500", answer(500), "http_500"],
      ["a 502", answer(502), "http_502"],
      ["a 503", answer(503), "http_503"],
      ["no answer", answer(null, { error: "network" }), "network"],
      ["a timeout", answer(null, { error: "timeout" }), "timeout"],
    ];

    it.each(cases)(
      "retries %s with the next wait, and counts it",
      (_name, result, error) => {
        expect(decide(result, 1, middle)).toEqual({
          kind: "retry",
          delayMs: 60_000,
          countFailure: true,
          error,
        });
        expect(decide(result, 4, middle)).toMatchObject({
          kind: "retry",
          delayMs: 7_200_000,
        });
      },
    );

    it.each(cases)(
      "gives up on %s after the last wait",
      (_name, result, error) => {
        expect(decide(result, maxAttempts, middle)).toEqual({
          kind: "failed",
          countFailure: true,
          disable: null,
          error,
        });
      },
    );
  });

  it("never puts a body, an address or a message of the other side in the error", () => {
    const outcome = decide(answer(500), 1);

    expect(JSON.stringify(outcome)).toBe(
      JSON.stringify({
        kind: "retry",
        delayMs: (outcome as { delayMs: number }).delayMs,
        countFailure: true,
        error: "http_500",
      }),
    );
  });

  it("turns an endpoint off after five failures in a row (the count itself is kept in the database)", () => {
    expect(disableAfterFailures).toBe(5);
  });
});
