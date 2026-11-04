import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.people";
import { action, headers, loader, meta } from "./settings.people";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  keys: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  listBlocked: vi.fn(),
  listMuted: vi.fn(),
  unblockUser: vi.fn(),
  unmuteUser: vi.fn(),
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
vi.mock("~server/db/blocks-mutes", () => ({
  listBlocked: mocks.listBlocked,
  listMuted: mocks.listMuted,
  unblockUser: mocks.unblockUser,
  unmuteUser: mocks.unmuteUser,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.keys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk_test_for_the_tests" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.listBlocked.mockReset().mockResolvedValue([
    {
      username: "ben_one",
      displayName: "Ben",
      avatarUrl: "https://img.clerk.com/b",
    },
  ]);
  mocks.listMuted.mockReset().mockResolvedValue([
    {
      username: "cat_one",
      displayName: null,
      avatarUrl: "http://insecure.example/c",
    },
  ]);
  mocks.unblockUser.mockReset().mockResolvedValue(undefined);
  mocks.unmuteUser.mockReset().mockResolvedValue(undefined);
});

const load = () =>
  loader({
    request: new Request("http://localhost/settings/people"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

function submit(
  fields: Record<string, string>,
  requestHeaders: Record<string, string> = {},
) {
  const request = new Request("http://localhost/settings/people", {
    method: "POST",
    headers: { Origin: "http://localhost", ...requestHeaders },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

type Answer = {
  data: { ok?: boolean; error?: string; intent?: string };
  init?: { status?: number; headers?: Record<string, string> };
};
const answer = (value: unknown) => value as Answer;

describe("the page of blocked and muted people (SAG-107)", () => {
  describe("loader", () => {
    it("reads the lists of the person of the session, and nobody else's", async () => {
      await load();

      expect(mocks.listBlocked).toHaveBeenCalledWith(db, "user-from-session");
      expect(mocks.listMuted).toHaveBeenCalledWith(db, "user-from-session");
    });

    it("gives the page the people, and a picture only when it is an HTTPS address", async () => {
      const result = await load();

      expect(result.blocked).toEqual([
        {
          username: "ben_one",
          displayName: "Ben",
          avatarUrl: "https://img.clerk.com/b",
        },
      ]);
      expect(result.muted).toEqual([
        { username: "cat_one", displayName: null, avatarUrl: null },
      ]);
    });

    it("sends a visitor to sign in and reads nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(load()).rejects.toBe(redirect);
      expect(mocks.listBlocked).not.toHaveBeenCalled();
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
          { intent: "unblock", username: "ben_one" },
          { "Content-Length": String(5 * 1024) },
        ),
      );

      expect(result.init?.status).toBe(413);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.unblockUser).not.toHaveBeenCalled();
    });

    it("refuses a form sent from another site", async () => {
      const result = answer(
        await submit(
          { intent: "unblock", username: "ben_one" },
          { Origin: "https://evil.example" },
        ),
      );

      expect(result.init?.status).toBe(403);
      expect(mocks.unblockUser).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(
        submit({ intent: "unblock", username: "ben_one" }),
      ).rejects.toBe(redirect);
      expect(mocks.unblockUser).not.toHaveBeenCalled();
    });

    it("is limited per person, and a limited request does nothing", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit({
        intent: "unblock",
        username: "ben_one",
      })) as Response;

      expect(result.status).toBe(429);
      expect(mocks.limit).toHaveBeenCalledWith({
        key: expect.stringContaining("social:user-from-session"),
      });
      expect(mocks.unblockUser).not.toHaveBeenCalled();
    });

    it.each([
      ["no intent", { username: "ben_one" }],
      ["no username", { intent: "unblock" }],
      [
        "an intent that does not exist",
        { intent: "block", username: "ben_one" },
      ],
      ["a username that is too short", { intent: "unblock", username: "ab" }],
      [
        "a username that is too long",
        { intent: "unblock", username: "a".repeat(31) },
      ],
      [
        "a field the form does not have",
        { intent: "unblock", username: "ben_one", userId: "x" },
      ],
    ])("refuses %s", async (_name, fields) => {
      const result = answer(await submit(fields as Record<string, string>));

      expect(result.init?.status).toBe(400);
      expect(result.data).toMatchObject({
        ok: false,
        error: "invalid_request",
      });
      expect(mocks.unblockUser).not.toHaveBeenCalled();
      expect(mocks.unmuteUser).not.toHaveBeenCalled();
    });
  });

  describe("POST: undoing", () => {
    it("unblocks for the person of the session, naming the other by username", async () => {
      const result = answer(
        await submit({ intent: "unblock", username: "ben_one" }),
      );

      expect(mocks.unblockUser).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ben_one",
      );
      expect(mocks.unmuteUser).not.toHaveBeenCalled();
      expect(result.data).toEqual({ ok: true, intent: "unblock" });
      expect(result.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    });

    it("stops muting for the person of the session", async () => {
      const result = answer(
        await submit({ intent: "unmute", username: "cat_one" }),
      );

      expect(mocks.unmuteUser).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "cat_one",
      );
      expect(mocks.unblockUser).not.toHaveBeenCalled();
      expect(result.data).toEqual({ ok: true, intent: "unmute" });
    });

    it("answers the same for a username that is not on the list, so it says nothing about who exists", async () => {
      const result = answer(
        await submit({ intent: "unblock", username: "nobody_here" }),
      );

      expect(result.data).toEqual({ ok: true, intent: "unblock" });
    });
  });
});
