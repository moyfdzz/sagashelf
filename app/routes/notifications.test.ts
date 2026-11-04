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

    it("sends a visitor to sign in and reads nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(load()).rejects.toBe(redirect);
      expect(mocks.listNotifications).not.toHaveBeenCalled();
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
