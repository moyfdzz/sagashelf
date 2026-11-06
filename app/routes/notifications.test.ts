import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/notifications";
import { action, headers, loader, meta } from "./notifications";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  keys: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  listNotifications: vi.fn(),
  countUnread: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  listPendingRequests: vi.fn(),
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: mocks.keys,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
// Clerk adds its own state to what the loader returns; here it only passes the data through.
vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (
    args: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ ...(handler(args) as object), __clerk_ssr_state: "state" }),
}));
vi.mock("~server/db/notifications", () => ({
  listNotifications: mocks.listNotifications,
  countUnread: mocks.countUnread,
  markRead: mocks.markRead,
  markAllRead: mocks.markAllRead,
}));
vi.mock("~server/db/follow-requests", () => ({
  listPendingRequests: mocks.listPendingRequests,
  acceptRequest: mocks.acceptRequest,
  declineRequest: mocks.declineRequest,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => mocks.locale,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const notificationId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: notificationId,
  type: "episode.aired",
  payload: {
    locale: "es",
    mediaId,
    title: "Severance",
    season: 2,
    number: 5,
  },
  createdAt: new Date("2026-11-03T12:00:00Z"),
  readAt: null,
  ...overrides,
});

beforeEach(() => {
  mocks.locale = "es";
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.keys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk_test_for_the_tests" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.listNotifications.mockReset().mockResolvedValue([row()]);
  mocks.countUnread.mockReset().mockResolvedValue(1);
  mocks.markRead.mockReset().mockResolvedValue(true);
  mocks.markAllRead.mockReset().mockResolvedValue(3);
  mocks.listPendingRequests.mockReset().mockResolvedValue([]);
  mocks.acceptRequest.mockReset().mockResolvedValue(true);
  mocks.declineRequest.mockReset().mockResolvedValue(true);
});

const load = () =>
  loader({
    request: new Request("http://localhost/notifications"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

function submit(
  fields: Record<string, string>,
  requestHeaders: Record<string, string> = {},
) {
  const request = new Request("http://localhost/notifications", {
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

describe("the inbox of notifications (SAG-102)", () => {
  describe("loader", () => {
    it("reads the notifications and the count of the person of the session, and nobody else's", async () => {
      await load();

      expect(mocks.listNotifications).toHaveBeenCalledWith(
        db,
        "user-from-session",
      );
      expect(mocks.countUnread).toHaveBeenCalledWith(db, "user-from-session");
    });

    it("gives the page the text of each one, a link to its entry and whether it was read", async () => {
      mocks.listNotifications.mockResolvedValue([
        row(),
        row({
          id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e71",
          readAt: new Date("2026-11-03T13:00:00Z"),
          payload: { title: "Andor", season: null, number: 3, mediaId },
        }),
      ]);

      const result = await load();

      expect(result.unread).toBe(1);
      expect(result.items).toEqual([
        {
          id: notificationId,
          title: "Severance",
          which: "temporada 2, episodio 5",
          href: `/library/${mediaId}`,
          createdAt: "2026-11-03T12:00:00.000Z",
          read: false,
        },
        {
          id: "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e71",
          title: "Andor",
          which: "episodio 3",
          href: `/library/${mediaId}`,
          createdAt: "2026-11-03T12:00:00.000Z",
          read: true,
        },
      ]);
    });

    it("writes the text in the language of the page", async () => {
      mocks.locale = "en";

      const result = await load();

      expect(result.items[0]?.which).toBe("season 2, episode 5");
    });

    it("links only to an id that is one, so a payload cannot send a person somewhere else", async () => {
      mocks.listNotifications.mockResolvedValue([
        row({ payload: { title: "A", mediaId: "../../admin/sagas" } }),
        row({ payload: { title: "B", mediaId: 7 } }),
        row({ payload: { title: "C" } }),
      ]);

      const result = await load();

      expect(result.items.map((item) => item.href)).toEqual([null, null, null]);
    });

    it("leaves out a row that says nothing readable, and a type it does not know", async () => {
      mocks.listNotifications.mockResolvedValue([
        row({ payload: {} }),
        row({ payload: { title: "  " } }),
        row({ type: "something.else" }),
        row({ payload: { title: "Kept" } }),
      ]);

      const result = await load();

      expect(result.items.map((item) => item.title)).toEqual(["Kept"]);
    });

    it("tells an administrator about a report, with a link to the profile and no picture (SAG-142)", async () => {
      mocks.listNotifications.mockResolvedValue([
        row({
          type: "report.created",
          payload: {
            kind: "picture",
            reason: "sexual_minors",
            username: "bob_reads",
          },
        }),
      ]);

      const result = await load();

      expect(result.items).toEqual([
        expect.objectContaining({
          id: notificationId,
          title: "report.notice.picture",
          which: "report.reasons.sexual_minors",
          href: "/u/bob_reads",
          read: false,
        }),
      ]);
    });

    it("leaves out a report it cannot read", async () => {
      mocks.listNotifications.mockResolvedValue([
        row({ type: "report.created", payload: { kind: "list" } }),
      ]);

      expect((await load()).items).toEqual([]);
    });

    it("reads the follow requests of the person of the session, and gives only a name and a username", async () => {
      mocks.listPendingRequests.mockResolvedValue([
        {
          username: "ana_public",
          displayName: "Ana",
          avatarUrl: "https://img.clerk.com/ana",
          canFollowBack: true,
          createdAt: new Date("2026-11-04T10:00:00Z"),
        },
        {
          username: "cat_hidden",
          displayName: null,
          avatarUrl: null,
          canFollowBack: false,
          createdAt: new Date("2026-11-04T09:00:00Z"),
        },
      ]);

      const result = await load();

      expect(mocks.listPendingRequests).toHaveBeenCalledWith(
        db,
        "user-from-session",
      );
      expect(result.requests).toEqual([
        {
          username: "ana_public",
          name: "Ana",
          canFollowBack: true,
          createdAt: "2026-11-04T10:00:00.000Z",
        },
        {
          username: "cat_hidden",
          name: "cat_hidden",
          canFollowBack: false,
          createdAt: "2026-11-04T09:00:00.000Z",
        },
      ]);
      // A session page has a narrow policy: no picture goes to it.
      expect(JSON.stringify(result.requests)).not.toContain("img.clerk.com");
    });

    it("sends a visitor to sign in and reads nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(load()).rejects.toBe(redirect);
      expect(mocks.listNotifications).not.toHaveBeenCalled();
      expect(mocks.listPendingRequests).not.toHaveBeenCalled();
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
        await submit({ intent: "all" }, { "Content-Length": String(5 * 1024) }),
      );

      expect(result.init?.status).toBe(413);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.markAllRead).not.toHaveBeenCalled();
    });

    it("refuses a form sent from another site", async () => {
      const result = answer(
        await submit({ intent: "all" }, { Origin: "https://evil.example" }),
      );

      expect(result.init?.status).toBe(403);
      expect(mocks.markAllRead).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(submit({ intent: "all" })).rejects.toBe(redirect);
      expect(mocks.markAllRead).not.toHaveBeenCalled();
    });

    it("is limited per person, and a limited request does nothing", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit({ intent: "all" })) as Response;

      expect(result.status).toBe(429);
      expect(mocks.limit).toHaveBeenCalledWith({
        key: expect.stringContaining("notifications:user-from-session"),
      });
      expect(mocks.markAllRead).not.toHaveBeenCalled();
    });

    it.each([
      ["no intent", {}],
      ["an intent that does not exist", { intent: "delete" }],
      ["a read without an id", { intent: "read" }],
      ["a read with an id that is not one", { intent: "read", id: "7" }],
      ["a field the form does not have", { intent: "all", userId: "other" }],
      ["an accept without a username", { intent: "accept" }],
      [
        "an accept with a username that is too short",
        { intent: "accept", username: "ab" },
      ],
      [
        "a decline with a field the form does not have",
        { intent: "decline", username: "ana_public", id: notificationId },
      ],
      [
        "an id of the person in the form of an accept",
        { intent: "accept_back", username: "ana_public", userId: "other" },
      ],
      [
        "a user in the form of a read",
        { intent: "read", id: notificationId, userId: "other" },
      ],
    ])("refuses %s", async (_name, fields) => {
      const result = answer(await submit(fields as Record<string, string>));

      expect(result.init?.status).toBe(400);
      expect(result.data).toMatchObject({
        ok: false,
        error: "invalid_request",
      });
      expect(mocks.markRead).not.toHaveBeenCalled();
      expect(mocks.markAllRead).not.toHaveBeenCalled();
      expect(mocks.acceptRequest).not.toHaveBeenCalled();
      expect(mocks.declineRequest).not.toHaveBeenCalled();
    });
  });

  describe("POST: answering a follow request", () => {
    it("accepts without following back, as the person of the session", async () => {
      const result = answer(
        await submit({ intent: "accept", username: "ana_public" }),
      );

      expect(mocks.acceptRequest).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_public",
        false,
      );
      expect(result.data).toEqual({ ok: true, intent: "accept" });
      expect(result.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    });

    it("accepts and follows back, as the person of the session", async () => {
      const result = answer(
        await submit({ intent: "accept_back", username: "ana_public" }),
      );

      expect(mocks.acceptRequest).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_public",
        true,
      );
      expect(result.data).toEqual({ ok: true, intent: "accept_back" });
    });

    it("declines, as the person of the session", async () => {
      const result = answer(
        await submit({ intent: "decline", username: "ana_public" }),
      );

      expect(mocks.declineRequest).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_public",
      );
      expect(result.data).toEqual({ ok: true, intent: "decline" });
    });

    it.each(["accept", "accept_back", "decline"])(
      "answers 404 for a %s of a request that is not there",
      async (intent) => {
        mocks.acceptRequest.mockResolvedValue(false);
        mocks.declineRequest.mockResolvedValue(false);

        const result = answer(
          await submit({ intent, username: "nobody_here" }),
        );

        expect(result.init?.status).toBe(404);
        expect(result.data).toMatchObject({
          ok: false,
          error: "request_not_found",
        });
      },
    );

    it("is limited per person like the other buttons", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit({
        intent: "accept",
        username: "ana_public",
      })) as Response;

      expect(result.status).toBe(429);
      expect(mocks.acceptRequest).not.toHaveBeenCalled();
    });
  });

  describe("POST: marking", () => {
    it("marks one as read for the person of the session, never one named by the form", async () => {
      const result = answer(
        await submit({ intent: "read", id: notificationId }),
      );

      expect(mocks.markRead).toHaveBeenCalledWith(
        db,
        "user-from-session",
        notificationId,
      );
      expect(result.data).toEqual({ ok: true, intent: "read" });
      expect(result.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    });

    it("answers 404 for a notification the person does not have", async () => {
      mocks.markRead.mockResolvedValue(false);

      const result = answer(
        await submit({ intent: "read", id: notificationId }),
      );

      expect(result.init?.status).toBe(404);
      expect(result.data).toMatchObject({ ok: false, error: "not_found" });
    });

    it("marks all as read for the person of the session", async () => {
      const result = answer(await submit({ intent: "all" }));

      expect(mocks.markAllRead).toHaveBeenCalledWith(db, "user-from-session");
      expect(result.data).toEqual({ ok: true, intent: "all" });
    });
  });
});
