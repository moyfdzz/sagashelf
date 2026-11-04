import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendTestMessage } from "./send-test-message";
import { fakeWebhookToken, fakeWebhookUrl } from "../testing/discord";

const mocks = vi.hoisted(() => ({
  queueTestEvent: vi.fn(),
  claimEvent: vi.fn(),
  deliverEvent: vi.fn(),
}));

vi.mock("../db/webhooks", () => ({
  queueTestEvent: mocks.queueTestEvent,
  claimEvent: mocks.claimEvent,
}));
vi.mock("./deliver-outbox", () => ({ deliverEvent: mocks.deliverEvent }));

const db = { execute: vi.fn() };
const userId = "user-from-session";
const endpointId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const eventId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

beforeEach(() => {
  mocks.queueTestEvent.mockReset().mockResolvedValue(eventId);
  mocks.claimEvent.mockReset().mockResolvedValue({
    id: eventId,
    type: "webhook.test",
    payload: { locale: "es" },
    attempt: 1,
    endpointId,
    // The claimed event holds the whole address: it must never come out of the function.
    url: fakeWebhookUrl,
  });
  mocks.deliverEvent.mockReset().mockResolvedValue({
    outcome: { kind: "delivered" },
    statusCode: 204,
    latencyMs: 80,
    endpointOn: true,
    resumeAt: null,
  });
});

describe("sendTestMessage", () => {
  it("queues the test for the person, in their language, takes it and sends it now", async () => {
    const result = await sendTestMessage(db, userId, endpointId, "en");

    expect(mocks.queueTestEvent).toHaveBeenCalledWith(
      db,
      userId,
      endpointId,
      "en",
    );
    expect(mocks.claimEvent).toHaveBeenCalledWith(db, eventId);
    expect(mocks.deliverEvent).toHaveBeenCalledWith(
      { db },
      expect.objectContaining({ id: eventId }),
    );
    expect(result).toEqual({
      found: true,
      delivered: true,
      status: 204,
      reason: null,
      endpointOn: true,
    });
  });

  it("says why it failed with a short code, and whether the endpoint was turned off", async () => {
    mocks.deliverEvent.mockResolvedValue({
      outcome: {
        kind: "failed",
        countFailure: false,
        disable: "not_found",
        error: "http_404",
      },
      statusCode: 404,
      latencyMs: 20,
      endpointOn: false,
      resumeAt: null,
    });

    expect(await sendTestMessage(db, userId, endpointId, "es")).toEqual({
      found: true,
      delivered: false,
      status: 404,
      reason: "http_404",
      endpointOn: false,
    });
  });

  it("keeps the status as null when nothing came back", async () => {
    mocks.deliverEvent.mockResolvedValue({
      outcome: {
        kind: "failed",
        countFailure: true,
        disable: null,
        error: "network",
      },
      statusCode: null,
      latencyMs: null,
      endpointOn: true,
      resumeAt: null,
    });

    expect(await sendTestMessage(db, userId, endpointId, "es")).toMatchObject({
      delivered: false,
      status: null,
      reason: "network",
    });
  });

  it("answers only the five things the page shows, never the address, the token or the event", async () => {
    const result = await sendTestMessage(db, userId, endpointId, "es");

    expect(Object.keys(result).sort()).toEqual([
      "delivered",
      "endpointOn",
      "found",
      "reason",
      "status",
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toContain(fakeWebhookToken);
    expect(text).not.toContain("discord.com");
    expect(text).not.toContain("payload");
  });

  it("sends nothing for a webhook that is not the person's, or is off", async () => {
    mocks.queueTestEvent.mockResolvedValue(null);

    expect(await sendTestMessage(db, userId, endpointId, "es")).toEqual({
      found: false,
    });
    expect(mocks.claimEvent).not.toHaveBeenCalled();
    expect(mocks.deliverEvent).not.toHaveBeenCalled();
  });

  it("sends nothing when the event cannot be taken", async () => {
    mocks.claimEvent.mockResolvedValue(null);

    expect(await sendTestMessage(db, userId, endpointId, "es")).toEqual({
      found: false,
    });
    expect(mocks.deliverEvent).not.toHaveBeenCalled();
  });
});
