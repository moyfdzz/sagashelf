import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.notifications";
import { action, headers, loader, meta } from "./settings.notifications";
import {
  fakeWebhookId,
  fakeWebhookToken,
  fakeWebhookUrl,
} from "~server/testing/discord";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  keys: vi.fn(),
  enabled: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  listEndpoints: vi.fn(),
  listRecentDeliveries: vi.fn(),
  addDiscordEndpoint: vi.fn(),
  removeEndpoint: vi.fn(),
  reenableEndpoint: vi.fn(),
  setEndpointEvents: vi.fn(),
  queueTestEvent: vi.fn(),
  claimEvent: vi.fn(),
  deliverEvent: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: mocks.keys,
  getWebhooksEnabled: mocks.enabled,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
// Clerk adds its own state to what the loader returns; here it only passes the data through.
vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (
    args: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ ...(handler(args) as object), __clerk_ssr_state: "state" }),
}));
vi.mock("~server/db/webhooks", () => ({
  maxEndpointsPerPerson: 3,
  listEndpoints: mocks.listEndpoints,
  listRecentDeliveries: mocks.listRecentDeliveries,
  addDiscordEndpoint: mocks.addDiscordEndpoint,
  removeEndpoint: mocks.removeEndpoint,
  reenableEndpoint: mocks.reenableEndpoint,
  setEndpointEvents: mocks.setEndpointEvents,
  queueTestEvent: mocks.queueTestEvent,
  claimEvent: mocks.claimEvent,
}));
vi.mock("~server/jobs/deliver-outbox", () => ({
  deliverEvent: mocks.deliverEvent,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => mocks.locale,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const endpointId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const eventId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

beforeEach(() => {
  mocks.locale = "es";
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.keys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk_test_for_the_tests" });
  mocks.enabled.mockReset().mockReturnValue(true);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.listEndpoints.mockReset().mockResolvedValue([
    {
      id: endpointId,
      kind: "discord",
      maskedUrl: `https://discord.com/api/webhooks/${fakeWebhookId}/…${fakeWebhookToken.slice(-4)}`,
      eventTypes: [],
      enabled: false,
      failureCount: 2,
      disabledAt: new Date("2026-11-02T12:00:00Z"),
      disabledReason: "not_found",
      createdAt: new Date("2026-11-01T12:00:00Z"),
    },
  ]);
  mocks.listRecentDeliveries.mockReset().mockResolvedValue([
    {
      id: "delivery-1",
      endpointId,
      type: "webhook.test",
      attempt: 1,
      statusCode: 204,
      latencyMs: 80,
      error: null,
      createdAt: new Date("2026-11-02T11:00:00Z"),
    },
  ]);
  mocks.addDiscordEndpoint.mockReset().mockResolvedValue("added");
  mocks.removeEndpoint.mockReset().mockResolvedValue(true);
  mocks.reenableEndpoint.mockReset().mockResolvedValue("enabled");
  mocks.setEndpointEvents.mockReset().mockResolvedValue(true);
  mocks.queueTestEvent.mockReset().mockResolvedValue(eventId);
  mocks.claimEvent.mockReset().mockResolvedValue({
    id: eventId,
    type: "webhook.test",
    payload: { locale: "es" },
    attempt: 1,
    endpointId,
    // The claimed event holds the whole address: it must never come out in an answer.
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

const load = () =>
  loader({
    request: new Request("http://localhost/settings/notifications"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

function submit(
  fields: Record<string, string>,
  requestHeaders: Record<string, string> = {},
) {
  const request = new Request("http://localhost/settings/notifications", {
    method: "POST",
    headers: { Origin: "http://localhost", ...requestHeaders },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

type Answer = {
  data: { ok?: boolean; error?: string; [key: string]: unknown };
  init?: { status?: number; headers?: Record<string, string> };
};
const answer = (value: unknown) => value as Answer;

describe("the notifications page (SAG-27)", () => {
  describe("loader", () => {
    it("reads the webhooks and the log of the person of the session, and nobody else's", async () => {
      await load();

      expect(mocks.listEndpoints).toHaveBeenCalledWith(db, "user-from-session");
      expect(mocks.listRecentDeliveries).toHaveBeenCalledWith(
        db,
        "user-from-session",
      );
    });

    it("gives the page only the masked address, never the whole one", async () => {
      const result = await load();

      expect(result.endpoints).toEqual([
        {
          id: endpointId,
          maskedUrl: `https://discord.com/api/webhooks/${fakeWebhookId}/…${fakeWebhookToken.slice(-4)}`,
          enabled: false,
          disabledAt: "2026-11-02T12:00:00.000Z",
          disabledReason: "not_found",
          episodeAlerts: false,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(fakeWebhookToken);
      expect(result.max).toBe(3);
      expect(result.enabled).toBe(true);
    });

    it("says whether a webhook has asked for the alerts of new episodes (SAG-28)", async () => {
      mocks.listEndpoints.mockResolvedValue([
        {
          ...(await mocks.listEndpoints()).at(0),
          eventTypes: ["episode.aired"],
        },
        { ...(await mocks.listEndpoints()).at(0), id: "other", eventTypes: [] },
      ]);

      const result = await load();

      expect(result.endpoints.map((e) => e.episodeAlerts)).toEqual([
        true,
        false,
      ]);
    });

    it("turns the dates of the log into text, so they cross to the browser", async () => {
      const result = await load();

      expect(result.deliveries).toEqual([
        {
          id: "delivery-1",
          endpointId,
          type: "webhook.test",
          attempt: 1,
          statusCode: 204,
          latencyMs: 80,
          error: null,
          createdAt: "2026-11-02T11:00:00.000Z",
        },
      ]);
    });

    it("reads nothing, and does not open the database, when the webhooks are off", async () => {
      mocks.enabled.mockReturnValue(false);

      const result = await load();

      expect(result).toMatchObject({
        enabled: false,
        endpoints: [],
        deliveries: [],
      });
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.listEndpoints).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in and reads nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(load()).rejects.toBe(redirect);
      expect(mocks.listEndpoints).not.toHaveBeenCalled();
    });

    it("refuses a deployment without Clerk keys", async () => {
      mocks.keys.mockReturnValue(null);

      await expect(load()).rejects.toMatchObject({
        data: { error: "auth_not_configured" },
      });
    });

    it("is private and not indexed", () => {
      const merged = headers({
        loaderHeaders: new Headers({ "Cache-Control": "public, max-age=60" }),
        actionHeaders: new Headers(),
      } as unknown as Route.HeadersArgs);

      expect(merged.get("Cache-Control")).toBe("private, no-store");
      expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
        name: "robots",
        content: "noindex, nofollow",
      });
    });
  });

  describe("POST: what stops a request before it does anything", () => {
    it("refuses a body that is too big, without reading who sent it", async () => {
      const result = answer(
        await submit(
          { intent: "add", url: "x" },
          { "Content-Length": "999999" },
        ),
      );

      expect(result.init?.status).toBe(413);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.addDiscordEndpoint).not.toHaveBeenCalled();
    });

    it("refuses a form sent from another site", async () => {
      const result = answer(
        await submit(
          { intent: "add", url: fakeWebhookUrl },
          { Origin: "https://evil.example" },
        ),
      );

      expect(result.init?.status).toBe(403);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.addDiscordEndpoint).not.toHaveBeenCalled();
    });

    it("sends a visitor away and touches nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(submit({ intent: "add", url: fakeWebhookUrl })).rejects.toBe(
        redirect,
      );
      expect(mocks.addDiscordEndpoint).not.toHaveBeenCalled();
    });

    it("says the webhooks are not available when they are off, and touches nothing", async () => {
      mocks.enabled.mockReturnValue(false);

      const result = answer(await submit({ intent: "test", id: endpointId }));

      expect(result.init?.status).toBe(503);
      expect(result.data).toMatchObject({ ok: false, error: "unavailable" });
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.queueTestEvent).not.toHaveBeenCalled();
      expect(mocks.deliverEvent).not.toHaveBeenCalled();
    });

    it("counts the request against the person, and answers 429 when they are over the limit", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = await submit({ intent: "test", id: endpointId });

      expect(mocks.limit).toHaveBeenCalledWith({
        key: expect.stringContaining("webhooks:user-from-session"),
      });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(429);
      expect(mocks.queueTestEvent).not.toHaveBeenCalled();
      expect(mocks.deliverEvent).not.toHaveBeenCalled();
    });

    it.each([
      ["no intent", {}],
      ["an intent it does not know", { intent: "delete-everything" }],
      ["an add with no address", { intent: "add" }],
      ["a test with no id", { intent: "test" }],
      ["an id that is not an id", { intent: "remove", id: "not-a-uuid" }],
      [
        "an id with SQL in it",
        { intent: "remove", id: "x'; DROP TABLE outbox;--" },
      ],
      [
        "a field the form does not have, such as the person",
        { intent: "add", url: fakeWebhookUrl, userId: "someone-else" },
      ],
      [
        "a field the form does not have, on a test",
        { intent: "test", id: endpointId, url: "https://evil.example" },
      ],
    ])("refuses %s", async (_name, fields) => {
      const result = answer(await submit(fields));

      expect(result.init?.status).toBe(400);
      expect(result.data).toMatchObject({
        ok: false,
        error: "invalid_request",
      });
      expect(mocks.addDiscordEndpoint).not.toHaveBeenCalled();
      expect(mocks.removeEndpoint).not.toHaveBeenCalled();
      expect(mocks.queueTestEvent).not.toHaveBeenCalled();
    });

    it("answers privately, so no cache keeps it", async () => {
      const result = answer(
        await submit({ intent: "add", url: fakeWebhookUrl }),
      );

      expect(result.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    });
  });

  describe("POST add", () => {
    it("saves the address of a Discord webhook for the person of the session", async () => {
      const result = answer(
        await submit({ intent: "add", url: fakeWebhookUrl }),
      );

      expect(mocks.addDiscordEndpoint).toHaveBeenCalledWith(
        db,
        "user-from-session",
        fakeWebhookUrl,
      );
      expect(result.data).toEqual({ ok: true, intent: "add" });
    });

    it("saves the address built from the checked parts, not the text that was typed", async () => {
      await submit({
        intent: "add",
        url: `  https://DISCORD.com:443/api/webhooks/${fakeWebhookId}/${fakeWebhookToken}?#  `,
      });

      expect(mocks.addDiscordEndpoint).toHaveBeenCalledWith(
        db,
        "user-from-session",
        fakeWebhookUrl,
      );
    });

    it.each([
      "https://example.com/hook",
      "http://discord.com/api/webhooks/123456789012345678/" + fakeWebhookToken,
      "https://discord.com.evil.example/api/webhooks/123456789012345678/" +
        fakeWebhookToken,
      "https://127.0.0.1/api/webhooks/123456789012345678/" + fakeWebhookToken,
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost:8787/api/webhooks/123456789012345678/" +
        fakeWebhookToken,
      "https://user@discord.com/api/webhooks/123456789012345678/" +
        fakeWebhookToken,
      "https://discord.com/api/webhooks/123456789012345678/" +
        fakeWebhookToken +
        "?redirect=https://evil.example",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
      "",
    ])(
      "refuses %s, saves nothing, and does not write the text back",
      async (typed) => {
        const result = answer(await submit({ intent: "add", url: typed }));

        expect(result.init?.status).toBe(400);
        expect(result.data).toEqual({ ok: false, error: "invalid_url" });
        expect(mocks.addDiscordEndpoint).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain("evil.example");
      },
    );

    it("says it is a duplicate, and says when the person has the most they may have", async () => {
      mocks.addDiscordEndpoint.mockResolvedValueOnce("duplicate");
      const duplicate = answer(
        await submit({ intent: "add", url: fakeWebhookUrl }),
      );
      mocks.addDiscordEndpoint.mockResolvedValueOnce("limit");
      const limit = answer(
        await submit({ intent: "add", url: fakeWebhookUrl }),
      );

      expect(duplicate.init?.status).toBe(409);
      expect(duplicate.data).toEqual({ ok: false, error: "duplicate" });
      expect(limit.init?.status).toBe(409);
      expect(limit.data).toEqual({ ok: false, error: "limit" });
    });

    it("never puts the token in what it answers", async () => {
      const result = await submit({ intent: "add", url: fakeWebhookUrl });

      expect(JSON.stringify(result)).not.toContain(fakeWebhookToken);
    });
  });

  describe("POST remove and enable", () => {
    it("removes a webhook of the person, by its id and the id of the session", async () => {
      const result = answer(await submit({ intent: "remove", id: endpointId }));

      expect(mocks.removeEndpoint).toHaveBeenCalledWith(
        db,
        "user-from-session",
        endpointId,
      );
      expect(result.data).toEqual({ ok: true, intent: "remove" });
    });

    it("turns a webhook back on, by its id and the id of the session", async () => {
      const result = answer(await submit({ intent: "enable", id: endpointId }));

      expect(mocks.reenableEndpoint).toHaveBeenCalledWith(
        db,
        "user-from-session",
        endpointId,
      );
      expect(result.data).toEqual({ ok: true, intent: "enable" });
    });

    it("says not found for a webhook that is not the person's, and does not say whose it is", async () => {
      mocks.removeEndpoint.mockResolvedValue(false);
      mocks.reenableEndpoint.mockResolvedValue("not_found");

      const removed = answer(
        await submit({ intent: "remove", id: endpointId }),
      );
      const enabled = answer(
        await submit({ intent: "enable", id: endpointId }),
      );

      for (const result of [removed, enabled]) {
        expect(result.init?.status).toBe(404);
        expect(result.data).toEqual({ ok: false, error: "not_found" });
      }
    });
  });

  describe("POST alerts (SAG-28)", () => {
    it("saves the alerts of new episodes for the webhook of the person of the session", async () => {
      const result = answer(
        await submit({ intent: "alerts", id: endpointId, episodes: "on" }),
      );

      expect(mocks.setEndpointEvents).toHaveBeenCalledWith(
        db,
        "user-from-session",
        endpointId,
        ["episode.aired"],
      );
      expect(result.data).toEqual({ ok: true, intent: "alerts" });
    });

    it("turns them off when the box is not ticked, since an unticked box is not sent at all", async () => {
      await submit({ intent: "alerts", id: endpointId });

      expect(mocks.setEndpointEvents).toHaveBeenCalledWith(
        db,
        "user-from-session",
        endpointId,
        [],
      );
    });

    it("says not found for a webhook that is not the person's, and does not say whose it is", async () => {
      mocks.setEndpointEvents.mockResolvedValue(false);

      const result = answer(
        await submit({ intent: "alerts", id: endpointId, episodes: "on" }),
      );

      expect(result.init?.status).toBe(404);
      expect(result.data).toEqual({ ok: false, error: "not_found" });
    });

    it.each([
      ["a value other than the one of the box", { episodes: "off" }],
      ["an event type typed by hand", { episodes: "webhook.test" }],
      ["a field the form does not have", { events: "episode.aired" }],
    ])("refuses %s", async (_name, extra) => {
      const result = answer(
        await submit({ intent: "alerts", id: endpointId, ...extra }),
      );

      expect(result.init?.status).toBe(400);
      expect(mocks.setEndpointEvents).not.toHaveBeenCalled();
    });
  });

  describe("POST enable, for a webhook that Discord says is gone (SAG-105)", () => {
    it("is refused, with a text of its own and not as if the webhook did not exist", async () => {
      mocks.reenableEndpoint.mockResolvedValue("not_allowed");

      const result = answer(await submit({ intent: "enable", id: endpointId }));

      expect(mocks.reenableEndpoint).toHaveBeenCalledWith(
        db,
        "user-from-session",
        endpointId,
      );
      expect(result.init?.status).toBe(409);
      expect(result.data).toEqual({ ok: false, error: "cannot_reenable" });
      expect(result.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    });

    it("tells apart a webhook that is not there from one that cannot be turned on", async () => {
      mocks.reenableEndpoint.mockResolvedValueOnce("not_found");
      const missing = answer(
        await submit({ intent: "enable", id: endpointId }),
      );
      mocks.reenableEndpoint.mockResolvedValueOnce("not_allowed");
      const gone = answer(await submit({ intent: "enable", id: endpointId }));

      expect(missing.init?.status).toBe(404);
      expect(missing.data).toEqual({ ok: false, error: "not_found" });
      expect(gone.init?.status).toBe(409);
      expect(gone.data).toEqual({ ok: false, error: "cannot_reenable" });
    });
  });

  describe("POST test", () => {
    it("queues the test for the person, in their language, and sends it now", async () => {
      mocks.locale = "en";

      const result = answer(await submit({ intent: "test", id: endpointId }));

      expect(mocks.queueTestEvent).toHaveBeenCalledWith(
        db,
        "user-from-session",
        endpointId,
        "en",
      );
      expect(mocks.claimEvent).toHaveBeenCalledWith(db, eventId);
      expect(mocks.deliverEvent).toHaveBeenCalledWith(
        { db },
        expect.objectContaining({ id: eventId }),
      );
      expect(result.data).toEqual({
        ok: true,
        intent: "test",
        delivered: true,
        status: 204,
        reason: null,
        endpointOn: true,
      });
    });

    it("falls back to Spanish for any language that is not English", async () => {
      mocks.locale = "fr";

      await submit({ intent: "test", id: endpointId });

      expect(mocks.queueTestEvent.mock.calls[0]?.[3]).toBe("es");
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

      const result = answer(await submit({ intent: "test", id: endpointId }));

      expect(result.data).toEqual({
        ok: true,
        intent: "test",
        delivered: false,
        status: 404,
        reason: "http_404",
        endpointOn: false,
      });
    });

    it("never puts the address, the token or the claimed event in what it answers", async () => {
      const result = await submit({ intent: "test", id: endpointId });

      const text = JSON.stringify(result);
      expect(text).not.toContain(fakeWebhookToken);
      expect(text).not.toContain("discord.com");
      expect(text).not.toContain("payload");
    });

    it("sends nothing for a webhook that is not the person's, or is off", async () => {
      mocks.queueTestEvent.mockResolvedValue(null);

      const result = answer(await submit({ intent: "test", id: endpointId }));

      expect(result.init?.status).toBe(404);
      expect(result.data).toEqual({ ok: false, error: "not_found" });
      expect(mocks.claimEvent).not.toHaveBeenCalled();
      expect(mocks.deliverEvent).not.toHaveBeenCalled();
    });

    it("sends nothing when the event cannot be taken", async () => {
      mocks.claimEvent.mockResolvedValue(null);

      const result = answer(await submit({ intent: "test", id: endpointId }));

      expect(result.init?.status).toBe(404);
      expect(mocks.deliverEvent).not.toHaveBeenCalled();
    });
  });
});
