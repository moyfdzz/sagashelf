import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/lists";
import { action, headers, loader, meta } from "./lists";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  keys: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  listOwnLists: vi.fn(),
  createList: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: mocks.keys,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (
    args: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ ...(handler(args) as object), __clerk_ssr_state: "state" }),
}));
vi.mock("~server/db/lists", () => ({
  listOwnLists: mocks.listOwnLists,
  createList: mocks.createList,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const listId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

const summary = (title: string) => ({
  id: listId,
  title,
  description: null,
  visibility: "private" as const,
  items: 2,
  updatedAt: new Date("2026-11-06T12:00:00Z"),
});

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.keys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk_test_for_the_tests" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.listOwnLists.mockReset().mockResolvedValue([summary("Best sci-fi")]);
  mocks.createList
    .mockReset()
    .mockResolvedValue({ outcome: "created", id: listId });
});

const load = (query = "") =>
  loader({
    request: new Request(`http://localhost/lists${query}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

function submit(
  fields: Record<string, string>,
  requestHeaders: Record<string, string> = {},
) {
  const request = new Request("http://localhost/lists", {
    method: "POST",
    headers: { Origin: "http://localhost", ...requestHeaders },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

type Answer = {
  data: { error?: string; values?: Record<string, string> };
  init?: { status?: number; headers?: Record<string, string> };
};
const answer = (value: unknown) => value as Answer;

const form = (overrides: Record<string, string> = {}) => ({
  intent: "create",
  title: "Best sci-fi",
  description: "Space and time",
  visibility: "friends",
  ...overrides,
});

describe("the page of the lists of a person (SAG-113)", () => {
  describe("loader", () => {
    it("reads the lists of the person of the session, and nobody else's", async () => {
      await load();

      expect(mocks.listOwnLists).toHaveBeenCalledWith(db, "user-from-session");
    });

    it("gives the page each list without the fields it does not draw", async () => {
      const result = await load();

      expect(result.lists).toEqual([
        {
          id: listId,
          title: "Best sci-fi",
          description: null,
          visibility: "private",
          items: 2,
        },
      ]);
      expect(result.atLimit).toBe(false);
    });

    it("says when the person is at the limit, so the page does not offer the form", async () => {
      mocks.listOwnLists.mockResolvedValue(
        Array.from({ length: 50 }, (_, index) => summary(`List ${index}`)),
      );

      expect((await load()).atLimit).toBe(true);
    });

    it("asks to confirm the delete of a list of the person that the address names", async () => {
      expect((await load()).confirming).toBeNull();
      expect((await load(`?confirm=${listId}`)).confirming).toEqual({
        id: listId,
        title: "Best sci-fi",
      });
    });

    it("does not open the confirmation for a list that is not in the person's lists, or for what is not an id", async () => {
      const someoneElses = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";

      expect((await load(`?confirm=${someoneElses}`)).confirming).toBeNull();
      expect((await load("?confirm=not-an-id")).confirming).toBeNull();
      expect((await load("?confirm=")).confirming).toBeNull();
    });

    it("shows a notice only for a word it knows", async () => {
      expect((await load("?notice=deleted")).notice).toBe("deleted");
      expect((await load("?notice=<b>x</b>")).notice).toBeNull();
    });

    it("sends a visitor to sign in and reads nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(load()).rejects.toBe(redirect);
      expect(mocks.listOwnLists).not.toHaveBeenCalled();
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
        await submit(form(), { "Content-Length": String(5 * 1024) }),
      );

      expect(result.init?.status).toBe(413);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.createList).not.toHaveBeenCalled();
    });

    it("refuses a form sent from another site", async () => {
      const result = answer(
        await submit(form(), { Origin: "https://evil.example" }),
      );

      expect(result.init?.status).toBe(403);
      expect(mocks.createList).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(submit(form())).rejects.toBe(redirect);
      expect(mocks.createList).not.toHaveBeenCalled();
    });

    it("is limited per person, and a limited request does nothing", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit(form())) as Response;

      expect(result.status).toBe(429);
      expect(mocks.limit).toHaveBeenCalledWith({
        key: expect.stringContaining("lists:user-from-session"),
      });
      expect(mocks.createList).not.toHaveBeenCalled();
    });

    it.each<[string, Record<string, string>]>([
      ["no title", { title: "" }],
      ["a title of only spaces", { title: "   " }],
      ["a title over 100 characters", { title: "a".repeat(101) }],
      ["a description over 500 characters", { description: "a".repeat(501) }],
      ["a visibility that does not exist", { visibility: "everyone" }],
      ["an intent that does not exist", { intent: "save" }],
      ["a field the form does not have", { ownerId: "someone-else" }],
    ])("refuses %s, and keeps what was written", async (_name, overrides) => {
      const result = answer(await submit(form(overrides)));

      expect(result.init?.status).toBe(400);
      expect(result.data.error).toBe("invalid_request");
      expect(result.data.values).toMatchObject({
        title: overrides.title ?? "Best sci-fi",
      });
      expect(mocks.createList).not.toHaveBeenCalled();
    });
  });

  describe("POST: creating a list", () => {
    it("creates it for the person of the session, with the text trimmed, and goes to its page", async () => {
      const result = (await submit(
        form({ title: "  Best sci-fi  ", description: "  Space  " }),
      )) as Response;

      expect(mocks.createList).toHaveBeenCalledWith(db, "user-from-session", {
        title: "Best sci-fi",
        description: "Space",
        visibility: "friends",
      });
      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe(
        `/lists/${listId}?notice=created`,
      );
    });

    it("stores an empty description as none", async () => {
      await submit(form({ description: "   " }));

      expect(mocks.createList).toHaveBeenCalledWith(
        db,
        "user-from-session",
        expect.objectContaining({ description: null }),
      );
    });

    it("counts a character as the database does, so 100 emoji are a valid title", async () => {
      await submit(form({ title: "🎬".repeat(100) }));

      expect(mocks.createList).toHaveBeenCalledTimes(1);
    });

    it("never takes the owner from the form", async () => {
      await submit(form({ ownerId: "someone-else" }));

      expect(mocks.createList).not.toHaveBeenCalled();
    });

    it.each(["duplicate", "limit"])(
      "answers %s with a 409 and what was written",
      async (outcome) => {
        mocks.createList.mockResolvedValue({ outcome });

        const result = answer(await submit(form()));

        expect(result.init?.status).toBe(409);
        expect(result.data).toEqual({
          error: outcome,
          values: {
            title: "Best sci-fi",
            description: "Space and time",
            visibility: "friends",
          },
        });
      },
    );
  });
});
