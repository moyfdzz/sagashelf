import { describe, expect, it } from "vitest";

import {
  getAdminWebhooks,
  parseWebhookDays,
  webhookDays,
} from "./admin-webhooks";
import type { SqlExecutor } from "./clerk-sync";
import { keepDays } from "./webhooks";

const now = new Date("2026-11-12T15:00:00Z");

const answering = (row: Record<string, unknown> | undefined): SqlExecutor => ({
  execute: async () => ({ rows: row ? [row] : [] }),
});

describe("the window of the webhooks (SAG-26)", () => {
  it("never offers a window longer than the log of deliveries is kept", () => {
    expect(Math.max(...webhookDays)).toBeLessThanOrEqual(keepDays);
  });

  it("accepts only the windows the page offers, and falls back to 30 days for the rest", () => {
    expect(parseWebhookDays("7")).toBe(7);
    expect(parseWebhookDays("30")).toBe(30);
    for (const raw of [null, "", "90", "14", "7 ", " 7", "7.0", "abc"]) {
      expect(parseWebhookDays(raw)).toBe(30);
    }
  });
});

describe("getAdminWebhooks (SAG-26)", () => {
  it("reads numbers that arrive as text and the JSON columns already parsed", async () => {
    const webhooks = await getAdminWebhooks(
      answering({
        clerk_processed: "12",
        clerk_rejected: { taken: 2, reserved_username: "1", empty: 0 },
        results: { ok: 8, server_error: "2", made_up: 5 },
        latency_avg: "250.5",
        latency_p95: 400,
        events: { pending: 1, delivered: "7" },
        pending_now: "3",
        endpoints_total: "5",
        endpoints_enabled: 4,
        endpoints_disabled: { not_found: 1 },
        per_day: [
          { day: "2026-11-11", attempts: 3, failed: "1" },
          { day: "2026-11-12T00:00:00", attempts: 0, failed: 0 },
        ],
      }),
      now,
      7,
    );

    expect(webhooks).toEqual({
      days: 7,
      from: "2026-11-06",
      to: "2026-11-12",
      clerk: {
        processed: 12,
        rejected: [
          { reason: "taken", count: 2 },
          { reason: "reserved_username", count: 1 },
        ],
      },
      attempts: {
        ok: 8,
        client_error: 0,
        server_error: 2,
        no_response: 0,
        other: 0,
      },
      latencyAvgMs: 250.5,
      latencyP95Ms: 400,
      events: { pending: 1, delivered: 7, failed: 0 },
      pendingNow: 3,
      endpoints: {
        total: 5,
        enabled: 4,
        disabled: [{ reason: "not_found", count: 1 }],
      },
      perDay: [
        { day: "2026-11-11", attempts: 3, failed: 1 },
        { day: "2026-11-12", attempts: 0, failed: 0 },
      ],
    });
  });

  it("reads the JSON columns when they arrive as text, and as nothing when the text is not JSON", async () => {
    const parsed = await getAdminWebhooks(
      answering({
        results: '{"ok":4}',
        per_day: '[{"day":"2026-11-12","attempts":4,"failed":0}]',
      }),
      now,
      7,
    );
    const broken = await getAdminWebhooks(
      answering({
        results: "not json",
        clerk_rejected: "not json",
        events: "[1]",
        per_day: "{}",
      }),
      now,
      7,
    );

    expect(parsed.attempts.ok).toBe(4);
    expect(parsed.perDay).toEqual([
      { day: "2026-11-12", attempts: 4, failed: 0 },
    ]);
    expect(broken.attempts.ok).toBe(0);
    expect(broken.clerk.rejected).toEqual([]);
    expect(broken.events).toEqual({ pending: 0, delivered: 0, failed: 0 });
    expect(broken.perDay).toEqual([]);
  });

  it("has no time when the statement gives none, and zeros when nothing comes back", async () => {
    const empty = await getAdminWebhooks(answering(undefined), now, 30);
    const odd = await getAdminWebhooks(
      answering({ latency_avg: null, clerk_processed: "abc" }),
      now,
      30,
    );

    expect(empty.from).toBe("2026-10-14");
    expect(empty).toMatchObject({
      latencyAvgMs: null,
      latencyP95Ms: null,
      pendingNow: 0,
    });
    expect(odd.clerk.processed).toBe(0);
    expect(odd.latencyAvgMs).toBeNull();
  });

  it("asks for whole days of UTC that end today", async () => {
    const asked: string[] = [];
    await getAdminWebhooks(
      {
        execute: async (query) => {
          asked.push(JSON.stringify(query));
          return { rows: [] };
        },
      },
      now,
      7,
    );

    expect(asked[0]).toContain("2026-11-06T00:00:00Z");
    expect(asked[0]).toContain("2026-11-13T00:00:00Z");
  });
});
