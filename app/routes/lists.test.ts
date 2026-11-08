import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/lists";
import { headers, loader, meta } from "./lists";
import * as route from "./lists";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  keys: vi.fn(),
  listOwnLists: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: mocks.keys,
}));
vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (
    args: unknown,
    handler: (args: unknown) => unknown,
  ) => ({ ...(handler(args) as object), __clerk_ssr_state: "state" }),
}));
vi.mock("~server/db/lists", () => ({ listOwnLists: mocks.listOwnLists }));
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
  mocks.listOwnLists.mockReset().mockResolvedValue([summary("Best sci-fi")]);
});

const load = (query = "") =>
  loader({
    request: new Request(`http://localhost/lists${query}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the page of the lists of a person (SAG-113)", () => {
  it("only reads: lists are made at /lists/new and changed at /lists/:id", () => {
    expect("action" in route).toBe(false);
  });

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

  it("says when the person is at the limit, so the page does not offer to make another", async () => {
    mocks.listOwnLists.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => summary(`List ${index}`)),
    );

    const result = await load();

    expect(result.atLimit).toBe(true);
    expect(result.maxLists).toBe(50);
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
