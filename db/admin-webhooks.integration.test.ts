import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getAdminWebhooks } from "../server/db/admin-webhooks";
import {
  outbox,
  processedWebhooks,
  webhookDeliveries,
  webhookEndpoints,
} from "../server/db/schema";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, outbox, processed_webhooks RESTART IDENTITY CASCADE`,
  );
});

// The window of 7 days that ends today: 6 to 12 November.
const now = new Date("2026-11-12T15:00:00Z");
const at = (iso: string) => new Date(iso);

let counter = 0;
async function endpointOf(
  userId: string,
  fields: Partial<typeof webhookEndpoints.$inferInsert> = {},
) {
  counter += 1;
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      userId,
      kind: "discord",
      url: `https://example.test/hook/${counter}`,
      ...fields,
    })
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new Error("The endpoint was not created");
  return row.id;
}

async function eventOf(
  endpointId: string | null,
  fields: Partial<typeof outbox.$inferInsert> = {},
) {
  counter += 1;
  const [row] = await db
    .insert(outbox)
    .values({
      type: "episode.aired",
      payload: {},
      idempotencyKey: `key-${counter}`,
      endpointId,
      ...fields,
    })
    .returning({ id: outbox.id });
  if (!row) throw new Error("The event was not created");
  return row.id;
}

describe("getAdminWebhooks (SAG-26)", () => {
  it("answers with zeros and a full chart on an empty site", async () => {
    const webhooks = await getAdminWebhooks(db, now, 7);

    expect(webhooks).toMatchObject({
      days: 7,
      from: "2026-11-06",
      to: "2026-11-12",
      clerk: { processed: 0, rejected: [] },
      attempts: {
        ok: 0,
        client_error: 0,
        server_error: 0,
        no_response: 0,
        other: 0,
      },
      latencyAvgMs: null,
      latencyP95Ms: null,
      events: { pending: 0, delivered: 0, failed: 0 },
      pendingNow: 0,
      endpoints: { total: 0, enabled: 0, disabled: [] },
    });
    expect(webhooks.perDay).toHaveLength(7);
    expect(webhooks.perDay[0]).toEqual({
      day: "2026-11-06",
      attempts: 0,
      failed: 0,
    });
  });

  it("counts the events of Clerk that were handled in the window, and why accounts were refused", async () => {
    await db.insert(processedWebhooks).values([
      {
        provider: "clerk",
        eventId: "a",
        processedAt: at("2026-11-12T01:00:00Z"),
      },
      {
        provider: "clerk",
        eventId: "b",
        processedAt: at("2026-11-06T00:00:00Z"),
      },
      {
        provider: "clerk",
        eventId: "old",
        processedAt: at("2026-11-05T23:59:59Z"),
      },
      {
        provider: "stripe",
        eventId: "other",
        processedAt: at("2026-11-10T00:00:00Z"),
      },
    ]);
    const rejected = (reason: string, when: string) =>
      eventOf(null, {
        type: "clerk.user_rejected",
        payload: { clerkId: "user_1", reason },
        createdAt: at(when),
      });
    await rejected("taken", "2026-11-11T10:00:00Z");
    await rejected("taken", "2026-11-12T10:00:00Z");
    await rejected("reserved_username", "2026-11-08T10:00:00Z");
    await rejected("taken", "2026-10-01T10:00:00Z");

    const webhooks = await getAdminWebhooks(db, now, 7);

    expect(webhooks.clerk.processed).toBe(2);
    expect(webhooks.clerk.rejected).toEqual([
      { reason: "taken", count: 2 },
      { reason: "reserved_username", count: 1 },
    ]);
  });

  it("sorts the attempts by what the endpoint answered, with the time they took", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const attempt = async (
      statusCode: number | null,
      latencyMs: number | null,
      when: string,
    ) => {
      const event = await eventOf(endpoint);
      await db.insert(webhookDeliveries).values({
        endpointId: endpoint,
        outboxId: event,
        attempt: 1,
        statusCode,
        latencyMs,
        createdAt: at(when),
      });
    };
    await attempt(204, 100, "2026-11-12T10:00:00Z");
    await attempt(200, 300, "2026-11-12T11:00:00Z");
    await attempt(429, 200, "2026-11-11T10:00:00Z");
    await attempt(503, 400, "2026-11-11T11:00:00Z");
    await attempt(null, null, "2026-11-08T10:00:00Z");
    await attempt(302, null, "2026-11-08T11:00:00Z");
    await attempt(200, 9999, "2026-11-05T10:00:00Z");

    const webhooks = await getAdminWebhooks(db, now, 7);

    expect(webhooks.attempts).toEqual({
      ok: 2,
      client_error: 1,
      server_error: 1,
      no_response: 1,
      other: 1,
    });
    expect(webhooks.latencyAvgMs).toBe(250);
    expect(webhooks.latencyP95Ms).toBeGreaterThan(300);
    expect(webhooks.latencyP95Ms).toBeLessThanOrEqual(400);
    const byDay = Object.fromEntries(
      webhooks.perDay.map((d) => [d.day, [d.attempts, d.failed]]),
    );
    expect(byDay["2026-11-12"]).toEqual([2, 0]);
    expect(byDay["2026-11-11"]).toEqual([2, 2]);
    expect(byDay["2026-11-08"]).toEqual([2, 2]);
    expect(byDay["2026-11-07"]).toEqual([0, 0]);
  });

  it("counts the events to deliver made in the window by where they stand, and what waits right now", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    await eventOf(endpoint, {
      status: "delivered",
      createdAt: at("2026-11-12T01:00:00Z"),
    });
    await eventOf(endpoint, {
      status: "delivered",
      createdAt: at("2026-11-10T01:00:00Z"),
    });
    await eventOf(endpoint, {
      status: "failed",
      createdAt: at("2026-11-09T01:00:00Z"),
    });
    await eventOf(endpoint, {
      status: "pending",
      createdAt: at("2026-11-12T02:00:00Z"),
    });
    // Waiting since before the window: it is not in `events`, but it is pending now.
    await eventOf(endpoint, {
      status: "pending",
      createdAt: at("2026-10-01T02:00:00Z"),
    });
    // Not a delivery: Clerk's refusal has no endpoint.
    await eventOf(null, { type: "clerk.user_rejected", status: "pending" });

    const webhooks = await getAdminWebhooks(db, now, 7);

    expect(webhooks.events).toEqual({ pending: 1, delivered: 2, failed: 1 });
    expect(webhooks.pendingNow).toBe(2);
  });

  it("counts the endpoints and why they are off", async () => {
    const ana = await newUser();
    await endpointOf(ana.id);
    await endpointOf(ana.id);
    await endpointOf(ana.id, {
      enabled: false,
      disabledAt: new Date(),
      disabledReason: "unauthorized",
    });
    await endpointOf(ana.id, {
      enabled: false,
      disabledAt: new Date(),
      disabledReason: "unauthorized",
    });
    await endpointOf(ana.id, {
      enabled: false,
      disabledAt: new Date(),
      disabledReason: "not_found",
    });

    const webhooks = await getAdminWebhooks(db, now, 7);

    expect(webhooks.endpoints).toEqual({
      total: 5,
      enabled: 2,
      disabled: [
        { reason: "unauthorized", count: 2 },
        { reason: "not_found", count: 1 },
      ],
    });
  });

  it("widens the window to 30 days", async () => {
    await db.insert(processedWebhooks).values([
      {
        provider: "clerk",
        eventId: "x",
        processedAt: at("2026-10-20T00:00:00Z"),
      },
    ]);

    expect((await getAdminWebhooks(db, now, 7)).clerk.processed).toBe(0);
    expect((await getAdminWebhooks(db, now, 30)).clerk.processed).toBe(1);
  });
});
