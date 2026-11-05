import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/social";
import { headers, loader, meta } from "./social";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  searchPeople: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getSearchLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/people-search", async (original) => ({
  ...(await original<typeof import("~server/db/people-search")>()),
  searchPeople: mocks.searchPeople,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.searchPeople.mockReset().mockResolvedValue([
    {
      username: "ana_reads",
      displayName: "Ana",
      avatarUrl: "https://img.clerk.com/ana",
    },
    {
      username: "ana_two",
      displayName: null,
      avatarUrl: "http://not-safe.example/x",
    },
  ]);
});

const load = (search = "") =>
  loader({
    request: new Request(`http://localhost/social${search}`, {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    }),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the search of people (SAG-115)", () => {
  it("sends a visitor to sign in, and reads nothing", async () => {
    const redirect = new Response(null, { status: 302 });
    mocks.requireUser.mockRejectedValue(redirect);

    await expect(load("?q=ana")).rejects.toBe(redirect);

    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.searchPeople).not.toHaveBeenCalled();
  });

  it("searches as the person of the session, and keeps only a safe picture", async () => {
    const result = await load("?q=%20@ANA%20");

    expect(mocks.searchPeople).toHaveBeenCalledWith(
      db,
      "user-from-session",
      "ana",
    );
    expect(result.status).toBe("results");
    expect(result.q).toBe("@ANA");
    expect(result.people).toEqual([
      {
        username: "ana_reads",
        displayName: "Ana",
        avatarUrl: "https://img.clerk.com/ana",
      },
      { username: "ana_two", displayName: null, avatarUrl: null },
    ]);
  });

  it.each([
    ["no search", "", "idle"],
    ["only spaces", "?q=%20%20", "idle"],
    ["only the at sign", "?q=@", "idle"],
    ["one character", "?q=a", "too_short"],
    ["one character after the at sign", "?q=@a", "too_short"],
  ])("does not search with %s", async (_, search, status) => {
    const result = await load(search);

    expect(result.status).toBe(status);
    expect(result.people).toEqual([]);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.searchPeople).not.toHaveBeenCalled();
  });

  it("finds nobody with more than a username can have, without asking the database", async () => {
    const result = await load(`?q=${"a".repeat(500)}`);

    expect(result.status).toBe("results");
    expect(result.people).toEqual([]);
    expect([...result.q]).toHaveLength(31);
    expect(mocks.searchPeople).not.toHaveBeenCalled();
  });

  it("counts each search against the person", async () => {
    await load("?q=ana");

    expect(mocks.limit).toHaveBeenCalledWith({
      key: "people-search:user-from-session:203.0.113.9",
    });
  });

  it("answers 429 over the limit, and does not search", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const thrown = (await load("?q=ana").catch(
      (error: unknown) => error,
    )) as Response;

    expect(thrown.status).toBe(429);
    expect(mocks.searchPeople).not.toHaveBeenCalled();
  });

  it("is never kept by a shared cache, nor by a search engine", () => {
    const answer = headers({
      loaderHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: undefined,
      parentHeaders: new Headers(),
    } as unknown as Route.HeadersArgs);

    expect(new Headers(answer).get("Cache-Control")).toMatch(/no-store/);
    expect(
      meta({ loaderData: { title: "x" } } as unknown as Route.MetaArgs),
    ).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});
