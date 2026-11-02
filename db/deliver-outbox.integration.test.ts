import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  outbox,
  webhookDeliveries,
  webhookEndpoints,
} from "../server/db/schema";
import {
  claimDueEvents,
  claimEvent,
  leaseMs,
  queueTestEvent,
} from "../server/db/webhooks";
import {
  deliverDueEvents,
  deliverEvent,
  eventsPerRun,
  type DeliveryDeps,
} from "../server/jobs/deliver-outbox";
import {
  disableAfterFailures,
  maxAttempts,
  retryDelaysMs,
} from "../server/webhooks/outcome";
import {
  fakeWebhookToken,
  fakeWebhookUrl,
  otherWebhookUrl,
} from "../server/testing/discord";
import { discordMessage } from "../server/webhooks/message";
import { createTestDb } from "./test-database";
import { factories } from "./test-helpers";

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

// A clock the tests move by hand. The random number is the middle of the spread: no jitter.
let clock = new Date("2026-11-02T12:00:00Z");
beforeEach(() => {
  clock = new Date("2026-11-02T12:00:00Z");
});
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

type Call = { url: string; init: RequestInit; body: unknown };

/** A `fetch` that records every call and answers with what the test says, per address. */
function fakeFetch(
  answers: Record<string, () => Response | Promise<Response> | Error>,
  fallback: () => Response = () => new Response(null, { status: 204 }),
) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      init: init ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const answer = answers[url]?.() ?? fallback();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, fetch: impl as unknown as typeof fetch };
}

const deps = (
  fetchImpl: typeof fetch,
  overrides: Partial<DeliveryDeps> = {},
): DeliveryDeps => ({
  db,
  fetch: fetchImpl,
  now: () => clock,
  random: () => 0.5,
  // A message for any event, so the delivery is tested without a type that nobody queues yet. The
  // tests of the test message and of an unknown type use the real one.
  messageFor: () => ({
    content: "An event of SagaShelf.",
    allowed_mentions: { parse: [] },
  }),
  ...overrides,
});

const real = { messageFor: discordMessage };

/** An event that was just claimed, or a failure that names what went wrong in the test. */
function taken<T>(value: T | null): T {
  if (value === null) throw new Error("Nothing was claimed");
  return value;
}

async function endpointOf(
  url = fakeWebhookUrl,
  values: Partial<typeof webhookEndpoints.$inferInsert> = {},
) {
  const user = await newUser();
  const [row] = await db
    .insert(webhookEndpoints)
    .values({ userId: user.id, kind: "discord", url, ...values })
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
      type: "library.completed",
      payload: { title: "Dune" },
      idempotencyKey: `deliver-${sequence}`,
      endpointId,
      nextAttemptAt: new Date("2026-11-02T11:00:00Z"),
      ...values,
    })
    .returning();
  if (!row) throw new Error("The event was not created");
  return row;
}

const eventRow = async (id: string) =>
  (await db.select().from(outbox).where(eq(outbox.id, id)))[0];
const endpointRow = async (id: string) =>
  (
    await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id))
  )[0];
const log = () =>
  db.select().from(webhookDeliveries).orderBy(webhookDeliveries.createdAt);

const reply =
  (status: number, init: ResponseInit = {}) =>
  () =>
    new Response(status === 204 ? null : "ignored", { status, ...init });

describe("delivering an event (SAG-27)", () => {
  it("posts the message to the address of the endpoint once, and marks the event delivered", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id, {
      type: "webhook.test",
      payload: { locale: "en" },
    });
    const server = fakeFetch({ [fakeWebhookUrl]: reply(204) });

    const summary = await deliverDueEvents(deps(server.fetch, real));

    expect(summary).toMatchObject({ found: 1, delivered: 1, errors: 0 });
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({
      url: fakeWebhookUrl,
      body: {
        content: expect.stringContaining("test message"),
        allowed_mentions: { parse: [] },
      },
    });
    expect(server.calls[0]?.init).toMatchObject({
      method: "POST",
      redirect: "manual",
    });
    expect(await eventRow(event.id)).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastError: null,
    });
    expect(await log()).toMatchObject([
      {
        endpointId: endpoint.id,
        outboxId: event.id,
        attempt: 1,
        statusCode: 204,
        error: null,
      },
    ]);
    expect((await log())[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does nothing, and asks no one, when nothing is due", async () => {
    const endpoint = await endpointOf();
    await eventFor(endpoint.id, {
      nextAttemptAt: new Date("2026-11-02T13:00:00Z"),
    });
    const server = fakeFetch({});

    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      found: 0,
      delivered: 0,
    });
    expect(server.calls).toHaveLength(0);
  });

  it("sends the event in the language it was queued with", async () => {
    const endpoint = await endpointOf();
    await eventFor(endpoint.id, {
      type: "webhook.test",
      payload: { locale: "es" },
    });
    const server = fakeFetch({});

    await deliverDueEvents(deps(server.fetch, real));

    expect(server.calls[0]?.body).toMatchObject({
      content: expect.stringContaining("mensaje de prueba"),
    });
  });

  it("delivers each event once, even when two runs start at the same time", async () => {
    const endpoint = await endpointOf();
    for (let index = 0; index < 8; index += 1) await eventFor(endpoint.id);
    const server = fakeFetch({});

    const [first, second] = await Promise.all([
      deliverDueEvents(deps(server.fetch), 5),
      deliverDueEvents(deps(server.fetch), 5),
    ]);

    expect(server.calls).toHaveLength(8);
    expect(first.delivered + second.delivered).toBe(8);
    expect(
      await db.select().from(outbox).where(eq(outbox.status, "delivered")),
    ).toHaveLength(8);
  });

  it("does not send an event again after it was delivered", async () => {
    const endpoint = await endpointOf();
    await eventFor(endpoint.id);
    const server = fakeFetch({});

    await deliverDueEvents(deps(server.fetch));
    advance(leaseMs + 1);
    await deliverDueEvents(deps(server.fetch));

    expect(server.calls).toHaveLength(1);
  });

  it("takes no more events than the limit of a run, and the rest wait for the next", async () => {
    const endpoint = await endpointOf();
    for (let index = 0; index < 5; index += 1) await eventFor(endpoint.id);
    const server = fakeFetch({});

    expect(await deliverDueEvents(deps(server.fetch), 2)).toMatchObject({
      found: 2,
      delivered: 2,
    });
    expect(await deliverDueEvents(deps(server.fetch), 2)).toMatchObject({
      found: 2,
    });
    expect(await deliverDueEvents(deps(server.fetch), 2)).toMatchObject({
      found: 1,
    });
    expect(server.calls).toHaveLength(5);
    expect(eventsPerRun).toBe(20);
  });

  it("never touches an event that is not a delivery", async () => {
    const internal = await eventFor(null, { type: "clerk.user_rejected" });
    const server = fakeFetch({});

    await deliverDueEvents(deps(server.fetch));

    expect(server.calls).toHaveLength(0);
    expect(await eventRow(internal.id)).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });
});

describe("a rate limit (SAG-27)", () => {
  it("waits for what Discord asked, does not blame the endpoint, and tries again after it", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id);
    let answers = 0;
    const server = fakeFetch({
      [fakeWebhookUrl]: () => {
        answers += 1;
        return answers === 1
          ? new Response(JSON.stringify({ retry_after: 30, global: false }), {
              status: 429,
              headers: {
                "Retry-After": "30",
                "Content-Type": "application/json",
              },
            })
          : new Response(null, { status: 204 });
      },
    });

    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      retried: 1,
      failed: 0,
    });
    expect(await eventRow(event.id)).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    expect((await eventRow(event.id))?.nextAttemptAt).toEqual(
      new Date(clock.getTime() + 30_000),
    );
    expect(await endpointRow(endpoint.id)).toMatchObject({
      failureCount: 0,
      enabled: true,
    });

    // Before the time is up, nothing is sent.
    advance(29_000);
    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      found: 0,
    });
    expect(server.calls).toHaveLength(1);

    advance(2_000);
    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      delivered: 1,
    });
    expect(await eventRow(event.id)).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
    expect((await log()).map((row) => row.statusCode)).toEqual([429, 204]);
  });

  it("leaves the other events of a webhook alone until its limit resets, when Discord says it is used up", async () => {
    const endpoint = await endpointOf();
    const first = await eventFor(endpoint.id, {
      nextAttemptAt: new Date("2026-11-02T10:00:00Z"),
    });
    const second = await eventFor(endpoint.id, {
      nextAttemptAt: new Date("2026-11-02T10:01:00Z"),
    });
    const server = fakeFetch({
      [fakeWebhookUrl]: () =>
        new Response(null, {
          status: 204,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset-After": "4",
          },
        }),
    });

    const summary = await deliverDueEvents(deps(server.fetch));

    expect(summary).toMatchObject({ delivered: 1, paused: 1 });
    expect(server.calls).toHaveLength(1);
    expect(await eventRow(first.id)).toMatchObject({ status: "delivered" });
    // The second one was given back: no try used, and due when the limit resets.
    expect(await eventRow(second.id)).toMatchObject({
      status: "pending",
      attempts: 0,
    });
    expect((await eventRow(second.id))?.nextAttemptAt).toEqual(
      new Date(clock.getTime() + 4_000),
    );

    advance(4_000);
    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      delivered: 1,
    });
  });

  it("does not hold back the events of another webhook", async () => {
    const limited = await endpointOf(fakeWebhookUrl);
    const free = await endpointOf(otherWebhookUrl);
    await eventFor(limited.id, {
      nextAttemptAt: new Date("2026-11-02T10:00:00Z"),
    });
    await eventFor(limited.id, {
      nextAttemptAt: new Date("2026-11-02T10:01:00Z"),
    });
    await eventFor(free.id, {
      nextAttemptAt: new Date("2026-11-02T10:02:00Z"),
    });
    const server = fakeFetch({
      [fakeWebhookUrl]: () =>
        new Response(null, {
          status: 204,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset-After": "9",
          },
        }),
    });

    const summary = await deliverDueEvents(deps(server.fetch));

    expect(summary).toMatchObject({ delivered: 2, paused: 1 });
    expect(server.calls.map((call) => call.url).sort()).toEqual(
      [fakeWebhookUrl, otherWebhookUrl].sort(),
    );
  });
});

describe("a failure that may pass (SAG-27)", () => {
  it.each([
    ["a 500", () => new Response("down", { status: 500 }), "http_500"],
    ["a 503", () => new Response("down", { status: 503 }), "http_503"],
    ["a network failure", () => new Error("connection reset"), "network"],
    [
      "a timeout",
      () => Object.assign(new Error("aborted"), { name: "TimeoutError" }),
      "timeout",
    ],
  ])(
    "retries %s after a minute, and counts it",
    async (_name, answer, code) => {
      const endpoint = await endpointOf();
      const event = await eventFor(endpoint.id);
      const server = fakeFetch({ [fakeWebhookUrl]: answer });

      expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
        retried: 1,
      });

      expect(await eventRow(event.id)).toMatchObject({
        status: "pending",
        lastError: code,
        attempts: 1,
      });
      expect((await eventRow(event.id))?.nextAttemptAt).toEqual(
        new Date(clock.getTime() + 60_000),
      );
      expect(await endpointRow(endpoint.id)).toMatchObject({
        failureCount: 1,
        enabled: true,
      });
    },
  );

  it("waits longer after each failure, as the ticket says, and gives up after the last wait", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id);
    const server = fakeFetch({ [fakeWebhookUrl]: reply(500) });

    const waits: number[] = [];
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      await deliverDueEvents(deps(server.fetch));
      const next = (await eventRow(event.id))?.nextAttemptAt;
      waits.push((next?.getTime() ?? 0) - clock.getTime());
      advance(waits[waits.length - 1] ?? 0);
      // The endpoint would be turned off by now; keep it on so only the event's tries are tested.
      await db
        .update(webhookEndpoints)
        .set({ failureCount: 0 })
        .where(eq(webhookEndpoints.id, endpoint.id));
    }
    expect(waits).toEqual([...retryDelaysMs]);

    await deliverDueEvents(deps(server.fetch));

    expect(await eventRow(event.id)).toMatchObject({
      status: "failed",
      attempts: maxAttempts,
      lastError: "http_500",
    });
    expect(server.calls).toHaveLength(maxAttempts);
    // And it is never sent again.
    advance(24 * 3_600_000);
    await deliverDueEvents(deps(server.fetch));
    expect(server.calls).toHaveLength(maxAttempts);
  });

  it("spreads the wait with the random number, so events that failed together do not return together", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id);
    const server = fakeFetch({ [fakeWebhookUrl]: reply(500) });

    await deliverDueEvents(deps(server.fetch, { random: () => 1 }));

    expect((await eventRow(event.id))?.nextAttemptAt).toEqual(
      new Date(clock.getTime() + 72_000),
    );
  });

  it(`turns the endpoint off after ${disableAfterFailures} failures in a row, with a notice, and stops sending to it`, async () => {
    const endpoint = await endpointOf();
    const events = [];
    for (let index = 0; index < disableAfterFailures + 2; index += 1) {
      events.push(
        await eventFor(endpoint.id, {
          nextAttemptAt: new Date(`2026-11-02T10:0${index}:00Z`),
        }),
      );
    }
    const server = fakeFetch({ [fakeWebhookUrl]: reply(503) });

    // One run takes all seven. The failures add up across the events, and the fifth turns the
    // endpoint off: the two that were left are not sent.
    const summary = await deliverDueEvents(deps(server.fetch));

    expect(summary).toMatchObject({
      found: disableAfterFailures + 2,
      retried: disableAfterFailures - 1,
      failed: 1,
      disabled: 1,
      skipped: 2,
      errors: 0,
    });
    expect(server.calls).toHaveLength(disableAfterFailures);
    expect(await endpointRow(endpoint.id)).toMatchObject({
      enabled: false,
      disabledReason: "too_many_failures",
      failureCount: disableAfterFailures,
    });
    expect((await endpointRow(endpoint.id))?.disabledAt).toBeInstanceOf(Date);
    // Every event of the endpoint is given up on, the ones that were tried and the ones that were not.
    const states = await Promise.all(events.map((event) => eventRow(event.id)));
    expect(states.map((row) => row?.status)).toEqual(
      Array(disableAfterFailures + 2).fill("failed"),
    );
    expect(states.slice(-2).map((row) => row?.lastError)).toEqual([
      "endpoint_disabled",
      "endpoint_disabled",
    ]);
    // And nothing is sent to it later.
    advance(10 * 3_600_000);
    await deliverDueEvents(deps(server.fetch));
    expect(server.calls).toHaveLength(disableAfterFailures);
  });

  it("clears the count of failures when an event is delivered again", async () => {
    const endpoint = await endpointOf(fakeWebhookUrl, { failureCount: 4 });
    await eventFor(endpoint.id);
    const server = fakeFetch({});

    await deliverDueEvents(deps(server.fetch));

    expect(await endpointRow(endpoint.id)).toMatchObject({
      failureCount: 0,
      enabled: true,
    });
  });
});

describe("a failure that will not pass (SAG-27)", () => {
  it.each([
    [404, "not_found"],
    [410, "not_found"],
    [401, "unauthorized"],
    [403, "unauthorized"],
  ])(
    "turns the endpoint off at once for a %s, and does not retry",
    async (status, reason) => {
      const endpoint = await endpointOf();
      const event = await eventFor(endpoint.id);
      const waiting = await eventFor(endpoint.id, {
        nextAttemptAt: new Date("2026-11-02T11:30:00Z"),
      });
      const server = fakeFetch({ [fakeWebhookUrl]: reply(status) });

      const summary = await deliverDueEvents(deps(server.fetch), 1);

      expect(summary).toMatchObject({ failed: 1, disabled: 1 });
      expect(await eventRow(event.id)).toMatchObject({
        status: "failed",
        lastError: `http_${status}`,
      });
      expect(await endpointRow(endpoint.id)).toMatchObject({
        enabled: false,
        disabledReason: reason,
        failureCount: 0,
      });
      expect(await eventRow(waiting.id)).toMatchObject({
        status: "failed",
        lastError: "endpoint_disabled",
      });

      advance(24 * 3_600_000);
      await deliverDueEvents(deps(server.fetch));
      expect(server.calls).toHaveLength(1);
    },
  );

  it("does not retry another 4xx, since the same message would be refused again, and counts it", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id);
    const server = fakeFetch({ [fakeWebhookUrl]: reply(400) });

    await deliverDueEvents(deps(server.fetch));

    expect(await eventRow(event.id)).toMatchObject({
      status: "failed",
      lastError: "http_400",
    });
    expect(await endpointRow(endpoint.id)).toMatchObject({
      enabled: true,
      failureCount: 1,
    });
  });

  it("does not follow a redirect and does not retry it", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id);
    const server = fakeFetch({
      [fakeWebhookUrl]: () =>
        new Response(null, {
          status: 307,
          headers: { Location: "https://evil.example/x" },
        }),
    });

    await deliverDueEvents(deps(server.fetch));

    expect(server.calls.map((call) => call.url)).toEqual([fakeWebhookUrl]);
    expect(await eventRow(event.id)).toMatchObject({
      status: "failed",
      lastError: "redirect",
    });
  });
});

describe("a dead endpoint does not hold back the others (SAG-27)", () => {
  it("delivers to the endpoints that work in the same run in which another one is turned off", async () => {
    const dead = await endpointOf(fakeWebhookUrl);
    const alive = await endpointOf(otherWebhookUrl);
    const deadEvent = await eventFor(dead.id, {
      nextAttemptAt: new Date("2026-11-02T10:00:00Z"),
    });
    const aliveEvent = await eventFor(alive.id, {
      nextAttemptAt: new Date("2026-11-02T10:01:00Z"),
    });
    const server = fakeFetch({
      [fakeWebhookUrl]: reply(404),
      [otherWebhookUrl]: reply(204),
    });

    const summary = await deliverDueEvents(deps(server.fetch));

    expect(summary).toMatchObject({ delivered: 1, failed: 1, disabled: 1 });
    expect(await eventRow(deadEvent.id)).toMatchObject({ status: "failed" });
    expect(await eventRow(aliveEvent.id)).toMatchObject({
      status: "delivered",
    });
    expect(await endpointRow(dead.id)).toMatchObject({ enabled: false });
    expect(await endpointRow(alive.id)).toMatchObject({
      enabled: true,
      failureCount: 0,
    });
  });

  it("keeps going when the result of one event cannot be recorded", async () => {
    const doomed = await endpointOf(fakeWebhookUrl);
    const fine = await endpointOf(otherWebhookUrl);
    await eventFor(doomed.id, {
      nextAttemptAt: new Date("2026-11-02T10:00:00Z"),
    });
    const fineEvent = await eventFor(fine.id, {
      nextAttemptAt: new Date("2026-11-02T10:01:00Z"),
    });
    const server = fakeFetch({
      // The person deletes the endpoint while its message is on its way: the log has nowhere to go.
      [fakeWebhookUrl]: async () => {
        await db
          .delete(webhookEndpoints)
          .where(eq(webhookEndpoints.id, doomed.id));
        return new Response(null, { status: 204 });
      },
    });

    const summary = await deliverDueEvents(deps(server.fetch));

    expect(summary.errors).toBe(1);
    expect(await eventRow(fineEvent.id)).toMatchObject({ status: "delivered" });
  });
});

describe("what is never sent (SAG-27)", () => {
  it("does not send to an address the table holds that is not a Discord webhook, and says so", async () => {
    // The table only insists on https, so a row can hold anything; the last check is at the send.
    const evil = await endpointOf("https://evil.example/collect");
    const event = await eventFor(evil.id);
    const server = fakeFetch({});

    const summary = await deliverDueEvents(deps(server.fetch));

    expect(server.calls).toHaveLength(0);
    expect(summary).toMatchObject({ found: 1, failed: 1 });
    expect(await eventRow(event.id)).toMatchObject({
      status: "failed",
      lastError: "invalid_url",
    });
  });

  it.each([
    "https://discord.com.evil.example/api/webhooks/123456789012345678/" +
      fakeWebhookToken,
    "https://127.0.0.1/api/webhooks/123456789012345678/" + fakeWebhookToken,
    "https://discord.com:8443/api/webhooks/123456789012345678/" +
      fakeWebhookToken,
    "https://user@discord.com/api/webhooks/123456789012345678/" +
      fakeWebhookToken,
    "https://discord.com/api/webhooks/123456789012345678/" +
      fakeWebhookToken +
      "?redirect=https://evil.example",
  ])("does not send to %s", async (url) => {
    const endpoint = await endpointOf(url);
    await eventFor(endpoint.id);
    const server = fakeFetch({});

    await deliverDueEvents(deps(server.fetch));

    expect(server.calls).toHaveLength(0);
  });

  it("gives up on an event of a type that has no message, without sending anything", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id, { type: "something.new" });
    const server = fakeFetch({});

    await deliverDueEvents(deps(server.fetch, real));

    expect(server.calls).toHaveLength(0);
    expect(await eventRow(event.id)).toMatchObject({
      status: "failed",
      lastError: "unknown_event",
    });
    expect(await endpointRow(endpoint.id)).toMatchObject({
      failureCount: 0,
      enabled: true,
    });
  });

  it("never puts the address, the token or the answer of the other side in the log, the events or the summary", async () => {
    const endpoint = await endpointOf();
    await eventFor(endpoint.id);
    const server = fakeFetch({
      [fakeWebhookUrl]: () =>
        new Response("secret-answer-body", { status: 500 }),
    });

    const summary = await deliverDueEvents(deps(server.fetch));

    const everything = JSON.stringify([
      summary,
      await log(),
      await db.select().from(outbox),
    ]);
    expect(everything).not.toContain(fakeWebhookToken);
    expect(everything).not.toContain("discord.com");
    expect(everything).not.toContain("secret-answer-body");
  });
});

describe("the test message (SAG-27)", () => {
  it("is sent right away and marks the event delivered", async () => {
    const endpoint = await endpointOf();
    const id = await queueTestEvent(db, endpoint.userId, endpoint.id, "en");
    const claimed = await claimEvent(db, String(id), clock);
    const server = fakeFetch({});

    const result = await deliverEvent(deps(server.fetch, real), taken(claimed));

    expect(result.outcome).toEqual({ kind: "delivered" });
    expect(result.statusCode).toBe(204);
    expect(server.calls).toHaveLength(1);
    expect(await eventRow(String(id))).toMatchObject({ status: "delivered" });
  });

  it("is never retried: a message that arrives hours later is not a test", async () => {
    const endpoint = await endpointOf();
    const id = await queueTestEvent(db, endpoint.userId, endpoint.id, "en");
    const claimed = await claimEvent(db, String(id), clock);
    const server = fakeFetch({ [fakeWebhookUrl]: reply(502) });

    const result = await deliverEvent(deps(server.fetch, real), taken(claimed));

    expect(result.outcome).toMatchObject({ kind: "failed", error: "http_502" });
    expect(await eventRow(String(id))).toMatchObject({ status: "failed" });
    advance(24 * 3_600_000);
    await deliverDueEvents(deps(server.fetch));
    expect(server.calls).toHaveLength(1);
  });

  it("tells the caller that the endpoint was turned off by it", async () => {
    const endpoint = await endpointOf();
    const id = await queueTestEvent(db, endpoint.userId, endpoint.id, "en");
    const claimed = await claimEvent(db, String(id), clock);
    const server = fakeFetch({ [fakeWebhookUrl]: reply(404) });

    const result = await deliverEvent(deps(server.fetch, real), taken(claimed));

    expect(result).toMatchObject({ endpointOn: false, statusCode: 404 });
    expect(await endpointRow(endpoint.id)).toMatchObject({
      disabledReason: "not_found",
    });
  });
});

describe("a run that dies half way (SAG-27)", () => {
  it("leaves the events it took alone for the lease, and sends them after it", async () => {
    const endpoint = await endpointOf();
    const event = await eventFor(endpoint.id);
    // A run takes the event and dies before it sends or records anything.
    await claimDueEvents(db, 10, clock);
    const server = fakeFetch({});

    advance(60_000);
    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      found: 0,
    });
    expect(server.calls).toHaveLength(0);

    advance(leaseMs);
    expect(await deliverDueEvents(deps(server.fetch))).toMatchObject({
      found: 1,
      delivered: 1,
    });
    expect(await eventRow(event.id)).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });
});
