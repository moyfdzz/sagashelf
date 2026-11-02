import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { exportAccount } from "../server/account/export";
import { eraseAccount } from "../server/db/erase-user";
import {
  outbox,
  users,
  webhookDeliveries,
  webhookEndpoints,
} from "../server/db/schema";
import {
  addDiscordEndpoint,
  claimDueEvents,
  claimEvent,
  enqueueEvent,
  enqueueEventInsert,
  keepDays,
  leaseMs,
  listEndpoints,
  listRecentDeliveries,
  maxEndpointsPerPerson,
  pruneDeliveries,
  queueTestEvent,
  recordTry,
  releaseEvent,
  removeEndpoint,
  reenableEndpoint,
} from "../server/db/webhooks";
import { disableAfterFailures } from "../server/webhooks/outcome";
import {
  fakeWebhookToken,
  fakeWebhookUrl,
  otherWebhookUrl,
} from "../server/testing/discord";
import { createTestDb } from "./test-database";
import { factories, failsWith } from "./test-helpers";

const { db, pool } = createTestDb();
const { newUser } = factories(db);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE users, outbox, webhook_endpoints, webhook_deliveries RESTART IDENTITY CASCADE`,
  );
});

async function endpointOf(
  userId: string,
  values: Partial<typeof webhookEndpoints.$inferInsert> = {},
) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      userId,
      kind: "discord",
      url: fakeWebhookUrl,
      eventTypes: ["library.completed"],
      ...values,
    })
    .returning();
  if (!row) throw new Error("The endpoint was not created");
  return row;
}

let sequence = 0;
async function eventFor(
  endpointId: string | null,
  values: Partial<typeof outbox.$inferInsert> = {},
) {
  sequence += 1;
  const [row] = await db
    .insert(outbox)
    .values({
      type: "webhook.test",
      payload: { locale: "en" },
      idempotencyKey: `test-${sequence}`,
      endpointId,
      // Before the fixed "now" of the tests below, so an event is due unless a test says otherwise.
      nextAttemptAt: new Date("2026-11-02T11:00:00Z"),
      ...values,
    })
    .returning();
  if (!row) throw new Error("The event was not created");
  return row;
}

const eventRow = async (id: string) => {
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id));
  return row;
};
const endpointRow = async (id: string) => {
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id));
  return row;
};

describe("the constraints of migration 0017 (SAG-27)", () => {
  it("does not let a person save the same address twice, but lets two people save it", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await endpointOf(ana.id);

    expect(await failsWith(endpointOf(ana.id))).toEqual({
      code: "23505",
      constraint: "webhook_endpoints_user_url_unique",
    });
    await expect(endpointOf(ben.id)).resolves.toBeTruthy();
  });

  it("says when an endpoint that is off was turned off", async () => {
    const ana = await newUser();

    expect(await failsWith(endpointOf(ana.id, { enabled: false }))).toEqual({
      code: "23514",
      constraint: "webhook_endpoints_disabled_check",
    });
    await expect(
      endpointOf(ana.id, { enabled: false, disabledAt: new Date() }),
    ).resolves.toBeTruthy();
  });

  it("accepts only the reasons the page has a text for", async () => {
    const ana = await newUser();

    expect(
      await failsWith(
        endpointOf(ana.id, {
          enabled: false,
          disabledAt: new Date(),
          disabledReason: "because I said so",
        }),
      ),
    ).toEqual({
      code: "23514",
      constraint: "webhook_endpoints_disabled_reason_check",
    });
    for (const [index, reason] of [
      "unauthorized",
      "not_found",
      "too_many_failures",
    ].entries()) {
      await expect(
        endpointOf(ana.id, {
          url: `https://discord.com/api/webhooks/1000000000000000${index}/${fakeWebhookToken}`,
          enabled: false,
          disabledAt: new Date(),
          disabledReason: reason,
        }),
      ).resolves.toBeTruthy();
    }
  });

  it("refuses an event for an endpoint that does not exist", async () => {
    expect(
      await failsWith(eventFor("0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f")),
    ).toMatchObject({ code: "23503" });
  });

  it("takes the events of an endpoint with it when it is deleted, and leaves the other events", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const mine = await eventFor(endpoint.id);
    const internal = await eventFor(null, { type: "clerk.user_rejected" });

    await db
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpoint.id));

    expect(await eventRow(mine.id)).toBeUndefined();
    expect(await eventRow(internal.id)).toBeDefined();
  });

  it("erases the endpoints, their events and their log with the account, and nothing else", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const anas = await endpointOf(ana.id);
    const bens = await endpointOf(ben.id);
    const anasEvent = await eventFor(anas.id);
    const bensEvent = await eventFor(bens.id);
    const internal = await eventFor(null, { type: "clerk.user_rejected" });
    await db.insert(webhookDeliveries).values({
      endpointId: anas.id,
      outboxId: anasEvent.id,
      attempt: 1,
      statusCode: 204,
    });

    expect(await eraseAccount(db, ana.clerkId)).toBe(true);

    expect(await db.select().from(webhookEndpoints)).toMatchObject([
      { id: bens.id },
    ]);
    expect(await eventRow(anasEvent.id)).toBeUndefined();
    expect(await eventRow(bensEvent.id)).toBeDefined();
    expect(await eventRow(internal.id)).toBeDefined();
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
    expect(
      await db.select().from(users).where(eq(users.id, ben.id)),
    ).toHaveLength(1);
  });
});

describe("addDiscordEndpoint, listEndpoints, removeEndpoint and reenableEndpoint (SAG-27)", () => {
  it("saves an address for the person, with no event types and on", async () => {
    const ana = await newUser();

    expect(await addDiscordEndpoint(db, ana.id, fakeWebhookUrl)).toBe("added");

    expect(await db.select().from(webhookEndpoints)).toMatchObject([
      {
        userId: ana.id,
        kind: "discord",
        url: fakeWebhookUrl,
        eventTypes: [],
        enabled: true,
        failureCount: 0,
        disabledAt: null,
        disabledReason: null,
      },
    ]);
  });

  it("says duplicate for an address the person already has, and saves nothing", async () => {
    const ana = await newUser();
    await addDiscordEndpoint(db, ana.id, fakeWebhookUrl);

    expect(await addDiscordEndpoint(db, ana.id, fakeWebhookUrl)).toBe(
      "duplicate",
    );
    expect(await db.select().from(webhookEndpoints)).toHaveLength(1);
  });

  it("lets another person save the same address", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await addDiscordEndpoint(db, ana.id, fakeWebhookUrl);

    expect(await addDiscordEndpoint(db, ben.id, fakeWebhookUrl)).toBe("added");
  });

  it("stops at the limit of endpoints per person, and the limit is theirs alone", async () => {
    const ana = await newUser();
    const ben = await newUser();
    for (let index = 0; index < maxEndpointsPerPerson; index += 1) {
      expect(
        await addDiscordEndpoint(
          db,
          ana.id,
          `https://discord.com/api/webhooks/1000000000000000${index}/${fakeWebhookToken}`,
        ),
      ).toBe("added");
    }

    expect(await addDiscordEndpoint(db, ana.id, otherWebhookUrl)).toBe("limit");
    expect(await addDiscordEndpoint(db, ben.id, otherWebhookUrl)).toBe("added");
    expect(maxEndpointsPerPerson).toBe(3);
  });

  it("lists only the endpoints of the person, oldest first, with the address masked", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await addDiscordEndpoint(db, ana.id, fakeWebhookUrl);
    await addDiscordEndpoint(db, ana.id, otherWebhookUrl);
    await addDiscordEndpoint(db, ben.id, fakeWebhookUrl);

    const list = await listEndpoints(db, ana.id);

    expect(list).toHaveLength(2);
    expect(list[0]?.maskedUrl).toBe(
      `https://discord.com/api/webhooks/123456789012345678/…${fakeWebhookToken.slice(-4)}`,
    );
    // The whole address is nowhere in what the page gets: not in a field, not in the JSON.
    expect(JSON.stringify(list)).not.toContain(fakeWebhookToken);
    expect(JSON.stringify(list)).not.toContain(
      fakeWebhookToken.split("").reverse().join(""),
    );
    expect(Object.keys(list[0] ?? {})).not.toContain("url");
  });

  it("shows why an endpoint is off", async () => {
    const ana = await newUser();
    await endpointOf(ana.id, {
      enabled: false,
      disabledAt: new Date("2026-11-02T12:00:00Z"),
      disabledReason: "not_found",
      failureCount: 2,
    });

    expect(await listEndpoints(db, ana.id)).toMatchObject([
      {
        enabled: false,
        disabledReason: "not_found",
        failureCount: 2,
        disabledAt: new Date("2026-11-02T12:00:00Z"),
      },
    ]);
  });

  it("deletes only an endpoint of the person, with its events", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const anas = await endpointOf(ana.id);
    const bens = await endpointOf(ben.id);
    const event = await eventFor(anas.id);

    // Ben cannot delete Ana's.
    expect(await removeEndpoint(db, ben.id, anas.id)).toBe(false);
    expect(await endpointRow(anas.id)).toBeDefined();

    expect(await removeEndpoint(db, ana.id, anas.id)).toBe(true);
    expect(await endpointRow(anas.id)).toBeUndefined();
    expect(await eventRow(event.id)).toBeUndefined();
    expect(await endpointRow(bens.id)).toBeDefined();
    expect(await removeEndpoint(db, ana.id, anas.id)).toBe(false);
  });

  it("turns back on an endpoint that was off, clearing the count, and only the person's own", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const off = await endpointOf(ana.id, {
      enabled: false,
      disabledAt: new Date(),
      disabledReason: "too_many_failures",
      failureCount: 5,
    });

    expect(await reenableEndpoint(db, ben.id, off.id)).toBe(false);
    expect(await endpointRow(off.id)).toMatchObject({ enabled: false });

    expect(await reenableEndpoint(db, ana.id, off.id)).toBe(true);
    expect(await endpointRow(off.id)).toMatchObject({
      enabled: true,
      disabledAt: null,
      disabledReason: null,
      failureCount: 0,
    });
    // It was already on: nothing to do.
    expect(await reenableEndpoint(db, ana.id, off.id)).toBe(false);
  });
});

describe("enqueueEvent (SAG-27)", () => {
  const completed = (userId: string, eventId = "evt-1") => ({
    userId,
    type: "library.completed",
    payload: { title: "Dune" },
    eventId,
  });

  it("queues one event for each endpoint of the person that asked for the type", async () => {
    const ana = await newUser();
    const first = await endpointOf(ana.id);
    const second = await endpointOf(ana.id, {
      url: otherWebhookUrl,
      eventTypes: ["library.completed", "episode.new"],
    });
    await endpointOf(ana.id, {
      url:
        "https://discord.com/api/webhooks/111111111111111111/" +
        fakeWebhookToken,
      eventTypes: ["episode.new"],
    });

    expect(await enqueueEvent(db, completed(ana.id))).toBe(2);

    const rows = await db.select().from(outbox);
    expect(rows.map((row) => row.endpointId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(rows[0]).toMatchObject({
      type: "library.completed",
      payload: { title: "Dune" },
      status: "pending",
      attempts: 0,
    });
  });

  it("queues nothing for an endpoint that is off, one that has no types, or somebody else's", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await endpointOf(ana.id, {
      enabled: false,
      disabledAt: new Date(),
    });
    await endpointOf(ana.id, { url: otherWebhookUrl, eventTypes: [] });
    await endpointOf(ben.id);

    expect(await enqueueEvent(db, completed(ana.id))).toBe(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("queues the same event once, however many times the change is tried", async () => {
    const ana = await newUser();
    await endpointOf(ana.id);

    expect(await enqueueEvent(db, completed(ana.id))).toBe(1);
    expect(await enqueueEvent(db, completed(ana.id))).toBe(0);
    expect(await enqueueEvent(db, completed(ana.id, "evt-2"))).toBe(1);

    expect(await db.select().from(outbox)).toHaveLength(2);
  });

  it("can be carried by the statement of a change, so both happen or neither does", async () => {
    const ana = await newUser();
    await endpointOf(ana.id);

    // The change here is renaming the person; the event is queued by the same statement.
    await db.execute(sql`
      WITH change AS (
        UPDATE users SET display_name = 'Ana' WHERE id = ${ana.id}::uuid RETURNING id
      ),
      queued AS (${enqueueEventInsert(completed(ana.id, "with-change"))})
      SELECT (SELECT count(*) FROM change) AS changed, (SELECT count(*) FROM queued) AS queued
    `);

    expect(await db.select().from(outbox)).toHaveLength(1);
    expect(
      (await db.select().from(users).where(eq(users.id, ana.id)))[0]
        ?.displayName,
    ).toBe("Ana");

    // A statement that fails after both are written leaves neither: the check on the name stops it.
    const failed = db.execute(sql`
      WITH change AS (
        UPDATE users SET username = '' WHERE id = ${ana.id}::uuid RETURNING id
      ),
      queued AS (${enqueueEventInsert(completed(ana.id, "never"))})
      SELECT count(*) FROM change, queued
    `);
    await expect(failed).rejects.toBeTruthy();
    expect(
      (await db.select().from(outbox)).map((row) => row.idempotencyKey),
    ).not.toContain(
      `never:${(await db.select().from(webhookEndpoints))[0]?.id}`,
    );
  });
});

describe("queueTestEvent (SAG-27)", () => {
  it("queues a test for an endpoint of the person that is on, in their language", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id, { eventTypes: [] });

    const id = await queueTestEvent(db, ana.id, endpoint.id, "en");

    expect(id).toBeTruthy();
    expect(await eventRow(String(id))).toMatchObject({
      type: "webhook.test",
      payload: { locale: "en" },
      endpointId: endpoint.id,
      status: "pending",
    });
  });

  it("queues a new test every time, since a test is never the same event", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);

    const first = await queueTestEvent(db, ana.id, endpoint.id, "es");
    const second = await queueTestEvent(db, ana.id, endpoint.id, "es");

    expect(first).not.toBe(second);
    expect(await db.select().from(outbox)).toHaveLength(2);
  });

  it("queues nothing for somebody else's endpoint, one that is off, or one that does not exist", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const anas = await endpointOf(ana.id);
    const off = await endpointOf(ana.id, {
      url: otherWebhookUrl,
      enabled: false,
      disabledAt: new Date(),
    });

    expect(await queueTestEvent(db, ben.id, anas.id, "es")).toBeNull();
    expect(await queueTestEvent(db, ana.id, off.id, "es")).toBeNull();
    expect(
      await queueTestEvent(
        db,
        ana.id,
        "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f",
        "es",
      ),
    ).toBeNull();
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});

describe("claimDueEvents and claimEvent (SAG-27)", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  it("takes the events that are due, oldest first, and counts the try", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const later = await eventFor(endpoint.id, {
      nextAttemptAt: new Date("2026-11-02T11:59:00Z"),
    });
    const first = await eventFor(endpoint.id, {
      nextAttemptAt: new Date("2026-11-02T11:00:00Z"),
    });

    const claimed = await claimDueEvents(db, 10, now);

    expect(claimed.map((event) => event.id)).toEqual(
      [first.id, later.id].sort(),
    );
    expect(claimed[0]).toMatchObject({
      type: "webhook.test",
      payload: { locale: "en" },
      attempt: 1,
      endpointId: endpoint.id,
      url: fakeWebhookUrl,
    });
  });

  it("leaves alone what is not due yet, what is not pending, and a disabled endpoint's events", async () => {
    const ana = await newUser();
    const on = await endpointOf(ana.id);
    const off = await endpointOf(ana.id, {
      url: otherWebhookUrl,
      enabled: false,
      disabledAt: new Date(),
    });
    await eventFor(on.id, { nextAttemptAt: new Date("2026-11-02T12:00:01Z") });
    await eventFor(on.id, { status: "delivered" });
    await eventFor(on.id, { status: "failed" });
    await eventFor(off.id);

    expect(await claimDueEvents(db, 10, now)).toEqual([]);
  });

  it("never takes an event that is not a delivery, such as the ones the Clerk webhook queues", async () => {
    await eventFor(null, { type: "clerk.user_rejected" });

    expect(await claimDueEvents(db, 10, now)).toEqual([]);
  });

  it("moves the next try out by the lease, so a run that dies does not leave events to be sent twice at once", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const event = await eventFor(endpoint.id);

    await claimDueEvents(db, 10, now);

    expect(await eventRow(event.id)).toMatchObject({ attempts: 1 });
    expect((await eventRow(event.id))?.nextAttemptAt).toEqual(
      new Date(now.getTime() + leaseMs),
    );
    // A second run, a minute later, finds nothing to take.
    expect(
      await claimDueEvents(db, 10, new Date(now.getTime() + 60_000)),
    ).toEqual([]);
    // After the lease the event is there again, as the second try.
    const again = await claimDueEvents(
      db,
      10,
      new Date(now.getTime() + leaseMs),
    );
    expect(again).toMatchObject([{ id: event.id, attempt: 2 }]);
  });

  it("takes no more than the limit", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    for (let index = 0; index < 5; index += 1) await eventFor(endpoint.id);

    expect(await claimDueEvents(db, 2, now)).toHaveLength(2);
    expect(await claimDueEvents(db, 2, now)).toHaveLength(2);
    expect(await claimDueEvents(db, 2, now)).toHaveLength(1);
    expect(await claimDueEvents(db, 2, now)).toHaveLength(0);
  });

  it("makes two runs at once take different events, never the same one", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    for (let index = 0; index < 10; index += 1) await eventFor(endpoint.id);

    const [first, second] = await Promise.all([
      claimDueEvents(db, 6, now),
      claimDueEvents(db, 6, now),
    ]);

    const ids = [...first, ...second].map((event) => event.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("skips an event that another run holds locked, instead of waiting for it", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const held = await eventFor(endpoint.id, {
      nextAttemptAt: new Date("2026-11-02T10:00:00Z"),
    });
    const free = await eventFor(endpoint.id);

    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT id FROM outbox WHERE id = $1 FOR UPDATE", [
        held.id,
      ]);

      const claimed = await claimDueEvents(db, 10, now);

      expect(claimed.map((event) => event.id)).toEqual([free.id]);
    } finally {
      await other.query("ROLLBACK");
      other.release();
    }
  });

  it("takes one event by its id for the test button, only while it is pending", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const event = await eventFor(endpoint.id);
    const done = await eventFor(endpoint.id, { status: "delivered" });
    const internal = await eventFor(null, { type: "clerk.user_rejected" });

    expect(await claimEvent(db, event.id, now)).toMatchObject({
      id: event.id,
      attempt: 1,
      url: fakeWebhookUrl,
    });
    // It is claimed now, but still pending: a second claim is another try. Delivered, or not a
    // delivery at all, it is never taken.
    expect(await claimEvent(db, done.id, now)).toBeNull();
    expect(await claimEvent(db, internal.id, now)).toBeNull();
  });

  it("gives an event back without using up the try", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const event = await eventFor(endpoint.id);
    await claimDueEvents(db, 10, now);

    const resumeAt = new Date("2026-11-02T12:00:05Z");
    await releaseEvent(db, event.id, resumeAt);

    expect(await eventRow(event.id)).toMatchObject({
      attempts: 0,
      nextAttemptAt: resumeAt,
      status: "pending",
    });
  });
});

describe("recordTry (SAG-27)", () => {
  const now = new Date("2026-11-02T12:00:00Z");

  async function claimedEvent(failureCount = 0) {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id, { failureCount });
    const event = await eventFor(endpoint.id);
    const [claimed] = await claimDueEvents(db, 1, now);
    if (!claimed) throw new Error("Nothing was claimed");
    return { ana, endpoint, event, claimed };
  }

  it("marks the event delivered, writes the log and clears the failures", async () => {
    const { endpoint, event, claimed } = await claimedEvent(3);

    const on = await recordTry(db, {
      event: claimed,
      statusCode: 204,
      latencyMs: 87,
      outcome: { kind: "delivered" },
      now,
    });

    expect(on).toBe(true);
    expect(await eventRow(event.id)).toMatchObject({
      status: "delivered",
      lastError: null,
    });
    expect(await endpointRow(endpoint.id)).toMatchObject({
      failureCount: 0,
      enabled: true,
    });
    expect(await db.select().from(webhookDeliveries)).toMatchObject([
      {
        endpointId: endpoint.id,
        outboxId: event.id,
        attempt: 1,
        statusCode: 204,
        latencyMs: 87,
        error: null,
      },
    ]);
  });

  it("keeps a retry pending for the time it says, and counts the failure", async () => {
    const { endpoint, event, claimed } = await claimedEvent();

    await recordTry(db, {
      event: claimed,
      statusCode: 502,
      latencyMs: 40,
      outcome: {
        kind: "retry",
        delayMs: 300_000,
        countFailure: true,
        error: "http_502",
      },
      now,
    });

    expect(await eventRow(event.id)).toMatchObject({
      status: "pending",
      lastError: "http_502",
      attempts: 1,
    });
    expect((await eventRow(event.id))?.nextAttemptAt).toEqual(
      new Date(now.getTime() + 300_000),
    );
    expect(await endpointRow(endpoint.id)).toMatchObject({
      failureCount: 1,
      enabled: true,
    });
    expect(await db.select().from(webhookDeliveries)).toMatchObject([
      { statusCode: 502, error: "http_502" },
    ]);
  });

  it("does not count a rate limit against the endpoint", async () => {
    const { endpoint, claimed } = await claimedEvent(2);

    await recordTry(db, {
      event: claimed,
      statusCode: 429,
      latencyMs: 12,
      outcome: {
        kind: "retry",
        delayMs: 2_000,
        countFailure: false,
        error: "http_429",
      },
      now,
    });

    expect(await endpointRow(endpoint.id)).toMatchObject({ failureCount: 2 });
  });

  it(`turns the endpoint off at the ${disableAfterFailures}th failure in a row, and gives up on its other events`, async () => {
    const { ana, endpoint, claimed } = await claimedEvent(
      disableAfterFailures - 1,
    );
    const waiting = await eventFor(endpoint.id);
    const otherEndpoint = await endpointOf(ana.id, { url: otherWebhookUrl });
    const otherEvent = await eventFor(otherEndpoint.id);

    const on = await recordTry(db, {
      event: claimed,
      statusCode: 500,
      latencyMs: 9,
      outcome: {
        kind: "retry",
        delayMs: 60_000,
        countFailure: true,
        error: "http_500",
      },
      now,
    });

    expect(on).toBe(false);
    expect(await endpointRow(endpoint.id)).toMatchObject({
      enabled: false,
      disabledReason: "too_many_failures",
      failureCount: disableAfterFailures,
    });
    expect((await endpointRow(endpoint.id))?.disabledAt).toBeInstanceOf(Date);
    // The event that brought the count to the limit is given up on too: it would otherwise be the
    // only one of this endpoint left pending.
    expect(await eventRow(claimed.id)).toMatchObject({
      status: "failed",
      lastError: "http_500",
    });
    expect(await eventRow(waiting.id)).toMatchObject({
      status: "failed",
      lastError: "endpoint_disabled",
    });
    // The other endpoint of the same person is as it was.
    expect(await endpointRow(otherEndpoint.id)).toMatchObject({
      enabled: true,
      failureCount: 0,
    });
    expect(await eventRow(otherEvent.id)).toMatchObject({ status: "pending" });
  });

  it("turns the endpoint off at once for a reason, whatever its count", async () => {
    for (const reason of ["unauthorized", "not_found"] as const) {
      await db.execute(
        sql`TRUNCATE users, outbox, webhook_endpoints, webhook_deliveries RESTART IDENTITY CASCADE`,
      );
      const { endpoint, event, claimed } = await claimedEvent();

      const on = await recordTry(db, {
        event: claimed,
        statusCode: reason === "unauthorized" ? 401 : 404,
        latencyMs: 5,
        outcome: {
          kind: "failed",
          countFailure: false,
          disable: reason,
          error: reason === "unauthorized" ? "http_401" : "http_404",
        },
        now,
      });

      expect(on).toBe(false);
      expect(await endpointRow(endpoint.id)).toMatchObject({
        enabled: false,
        disabledReason: reason,
        failureCount: 0,
      });
      expect(await eventRow(event.id)).toMatchObject({ status: "failed" });
    }
  });

  it("keeps the first reason when the endpoint was already off, and does not turn it off twice", async () => {
    const { endpoint, claimed } = await claimedEvent();
    await db
      .update(webhookEndpoints)
      .set({
        enabled: false,
        disabledAt: new Date("2026-11-01T00:00:00Z"),
        disabledReason: "not_found",
      })
      .where(eq(webhookEndpoints.id, endpoint.id));

    await recordTry(db, {
      event: claimed,
      statusCode: 401,
      latencyMs: 5,
      outcome: {
        kind: "failed",
        countFailure: false,
        disable: "unauthorized",
        error: "http_401",
      },
      now,
    });

    expect(await endpointRow(endpoint.id)).toMatchObject({
      disabledReason: "not_found",
      disabledAt: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("records a try once: the same attempt twice leaves one line in the log", async () => {
    const { claimed } = await claimedEvent();
    const tried = {
      event: claimed,
      statusCode: 204,
      latencyMs: 1,
      outcome: { kind: "delivered" } as const,
      now,
    };

    await recordTry(db, tried);
    await recordTry(db, tried);

    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
  });

  it("puts no address and no token in the log or in the event", async () => {
    const { claimed } = await claimedEvent();

    await recordTry(db, {
      event: claimed,
      statusCode: 500,
      latencyMs: 1,
      outcome: {
        kind: "retry",
        delayMs: 60_000,
        countFailure: true,
        error: "http_500",
      },
      now,
    });

    const everything = JSON.stringify([
      await db.select().from(webhookDeliveries),
      await db.select().from(outbox),
    ]);
    expect(everything).not.toContain(fakeWebhookToken);
    expect(everything).not.toContain("discord.com");
  });
});

describe("listRecentDeliveries (SAG-27)", () => {
  it("lists the log of the person, newest first, up to the limit, and nobody else's", async () => {
    const ana = await newUser();
    const ben = await newUser();
    const anas = await endpointOf(ana.id);
    const bens = await endpointOf(ben.id);
    for (let index = 1; index <= 3; index += 1) {
      const event = await eventFor(anas.id);
      await db.insert(webhookDeliveries).values({
        endpointId: anas.id,
        outboxId: event.id,
        attempt: 1,
        statusCode: 200 + index,
        createdAt: new Date(`2026-11-0${index}T12:00:00Z`),
      });
    }
    const bensEvent = await eventFor(bens.id);
    await db.insert(webhookDeliveries).values({
      endpointId: bens.id,
      outboxId: bensEvent.id,
      attempt: 1,
      statusCode: 500,
    });

    const list = await listRecentDeliveries(db, ana.id, 2);

    expect(list.map((row) => row.statusCode)).toEqual([203, 202]);
    expect(list[0]).toMatchObject({
      endpointId: anas.id,
      type: "webhook.test",
      attempt: 1,
    });
    expect(list.map((row) => row.statusCode)).not.toContain(500);
  });
});

describe("pruneDeliveries (SAG-27)", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const old = new Date(now.getTime() - (keepDays + 1) * 86_400_000);

  it("deletes the log and the events that are older than the days it keeps, and no more", async () => {
    const ana = await newUser();
    const endpoint = await endpointOf(ana.id);
    const oldDelivered = await eventFor(endpoint.id, { status: "delivered" });
    const oldFailed = await eventFor(endpoint.id, { status: "failed" });
    const oldPending = await eventFor(endpoint.id);
    const recent = await eventFor(endpoint.id, { status: "delivered" });
    const internal = await eventFor(null, {
      type: "clerk.user_rejected",
      status: "failed",
    });
    await db.execute(
      sql`UPDATE outbox SET updated_at = ${old.toISOString()}::timestamptz WHERE id IN (${oldDelivered.id}::uuid, ${oldFailed.id}::uuid, ${oldPending.id}::uuid, ${internal.id}::uuid)`,
    );
    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      outboxId: oldPending.id,
      attempt: 1,
      createdAt: old,
    });
    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      outboxId: recent.id,
      attempt: 1,
      createdAt: now,
    });

    expect(await pruneDeliveries(db, now)).toBe(2);

    expect(await eventRow(oldDelivered.id)).toBeUndefined();
    expect(await eventRow(oldFailed.id)).toBeUndefined();
    // Still waiting, recent, or not a delivery: kept.
    expect(await eventRow(oldPending.id)).toBeDefined();
    expect(await eventRow(recent.id)).toBeDefined();
    expect(await eventRow(internal.id)).toBeDefined();
    // The old line of the log goes, even for an event that is still waiting; the recent one stays.
    expect(await db.select().from(webhookDeliveries)).toMatchObject([
      { outboxId: recent.id },
    ]);
  });
});

describe("the export of the account (SAG-27)", () => {
  it("lists the webhooks of the person with the address masked, and nobody else's", async () => {
    const ana = await newUser();
    const ben = await newUser();
    await endpointOf(ana.id, {
      eventTypes: ["library.completed"],
      enabled: false,
      disabledAt: new Date(),
      disabledReason: "not_found",
    });
    await endpointOf(ben.id, { url: otherWebhookUrl });

    const data = await exportAccount(
      db,
      ana.id,
      new Date("2026-11-02T12:00:00Z"),
    );

    expect(data?.webhooks).toMatchObject([
      {
        kind: "discord",
        maskedUrl: `https://discord.com/api/webhooks/123456789012345678/…${fakeWebhookToken.slice(-4)}`,
        eventTypes: ["library.completed"],
        enabled: false,
      },
    ]);
    // The token is what lets anyone post in the channel: it is not in the file, in any form, and the
    // other person's address is not either. Neither is the id of the endpoint.
    const text = JSON.stringify(data);
    expect(text).not.toContain(fakeWebhookToken);
    expect(text).not.toContain(fakeWebhookToken.split("").reverse().join(""));
    expect(text).not.toContain("987654321098765432");
  });

  it("gives an empty list for a person who connected none", async () => {
    const ana = await newUser();

    expect((await exportAccount(db, ana.id))?.webhooks).toEqual([]);
  });
});
