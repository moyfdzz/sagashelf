import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/social";
import { action, headers, loader, meta, shouldRevalidate } from "./social";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  searchPeople: vi.fn(),
  limit: vi.fn(),
  writeLimit: vi.fn(),
  readFeed: vi.fn(),
  setLike: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getSearchLimiter: () => ({ limit: mocks.limit }),
  getWriteLimiter: () => ({ limit: mocks.writeLimit }),
}));
vi.mock("~server/db/feed", async (original) => ({
  ...(await original<typeof import("~server/db/feed")>()),
  readFeed: mocks.readFeed,
  setLike: mocks.setLike,
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
  getLocale: () => "en",
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.writeLimit.mockReset().mockResolvedValue({ success: true });
  mocks.readFeed.mockReset().mockResolvedValue({ events: [], next: null });
  mocks.setLike.mockReset().mockResolvedValue({ likes: 3 });
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

  it("says so over the limit, does not search, and still shows the feed", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = await load("?q=ana");

    expect(result.status).toBe("rate_limited");
    expect(result.people).toEqual([]);
    expect(mocks.searchPeople).not.toHaveBeenCalled();
    expect(mocks.readFeed).toHaveBeenCalledTimes(1);
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

const eventId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const cursor = `1763640000123456_${eventId}`;

describe("the feed (SAG-22)", () => {
  it("reads the feed of the person of the session, in the language of the page", async () => {
    const result = await load();

    expect(mocks.readFeed).toHaveBeenCalledWith(
      db,
      "user-from-session",
      "en",
      null,
    );
    expect(result.feed).toEqual({ items: [], next: null, older: false });
    // The feed alone never spends the limit of searches.
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("reads the page the address asks for, and passes on where the next one starts", async () => {
    mocks.readFeed.mockResolvedValue({
      events: [
        {
          id: eventId,
          type: "rated",
          payload: { score: 9 },
          createdAt: new Date("2026-11-20T12:00:00.000Z"),
          level: "public",
          mine: false,
          actor: { username: "ana_reads", displayName: null, avatarUrl: null },
          media: { id: eventId, type: "movie", title: "Dune", imageUrl: null },
          likes: 1,
          liked: false,
        },
      ],
      next: { micros: "1", id: eventId },
    });

    const result = await load(`?before=${cursor}`);

    expect(mocks.readFeed).toHaveBeenCalledWith(db, "user-from-session", "en", {
      micros: "1763640000123456",
      id: eventId,
    });
    expect(result.feed.items).toEqual([
      expect.objectContaining({ id: eventId, kind: "rated", score: 9 }),
    ]);
    expect(result.feed.next).toBe(`1_${eventId}`);
    expect(result.feed.older).toBe(true);
  });

  it("reads the newest page when the cursor is not one we wrote", async () => {
    const result = await load("?before=yesterday");

    expect(mocks.readFeed).toHaveBeenCalledWith(
      db,
      "user-from-session",
      "en",
      null,
    );
    expect(result.feed.older).toBe(false);
  });
});

const origin = "http://localhost";

const like = (
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  action({
    request: new Request(`${origin}/social`, {
      method: "POST",
      headers: { Origin: origin, ...headers },
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs);

type Answer = { data: unknown; init: { status?: number } | null };

describe("a like (SAG-22)", () => {
  it("likes as the person of the session, and answers the new count", async () => {
    const answer = (await like({
      activityId: eventId,
      liked: "true",
    })) as unknown as Answer;

    expect(mocks.setLike).toHaveBeenCalledWith(
      db,
      "user-from-session",
      eventId,
      true,
    );
    expect(answer.data).toEqual({ ok: true, liked: true, likes: 3 });
  });

  it("takes a like back from an event that is hidden now, without a count and without an error", async () => {
    mocks.setLike.mockResolvedValue({ likes: null });

    const answer = (await like({
      activityId: eventId,
      liked: "false",
    })) as unknown as Answer;

    expect(answer.init?.status ?? 200).toBe(200);
    expect(answer.data).toEqual({ ok: true, liked: false, likes: null });
  });

  it("says why over the limit, before the form or the database", async () => {
    mocks.writeLimit.mockResolvedValue({ success: false });

    const answer = (await like({
      activityId: eventId,
      liked: "true",
    })) as unknown as Answer;

    expect(answer.init?.status).toBe(429);
    expect(answer.data).toEqual({ ok: false, error: "rate_limited" });
    expect(mocks.setLike).not.toHaveBeenCalled();
  });

  it("takes a like back", async () => {
    await like({ activityId: eventId, liked: "false" });

    expect(mocks.setLike).toHaveBeenCalledWith(
      db,
      "user-from-session",
      eventId,
      false,
    );
  });

  it.each([
    ["no id", { liked: "true" }],
    ["an id that is no id", { activityId: "abc", liked: "true" }],
    ["a yes or no that is neither", { activityId: eventId, liked: "yes" }],
    [
      "a field it does not know",
      { activityId: eventId, liked: "true", userId: "someone-else" },
    ],
  ])("refuses a form with %s, before the database", async (_, fields) => {
    const answer = (await like(fields)) as unknown as Answer;

    expect(answer.init?.status).toBe(400);
    expect(mocks.setLike).not.toHaveBeenCalled();
  });

  it("answers 404 for an event it may not like, whatever the reason", async () => {
    mocks.setLike.mockResolvedValue(null);

    const answer = (await like({
      activityId: eventId,
      liked: "true",
    })) as unknown as Answer;

    expect(answer.init?.status).toBe(404);
    expect(answer.data).toEqual({ ok: false, error: "not_found" });
  });

  it("sends a form without JavaScript back to the page of the feed it came from", async () => {
    const answer = (await like(
      { activityId: eventId, liked: "true" },
      {
        "Sec-Fetch-Dest": "document",
        Referer: `${origin}/social?q=ana&before=${cursor}`,
      },
    )) as Response;

    expect(answer.status).toBe(303);
    expect(answer.headers.get("Location")).toBe(`/social?before=${cursor}`);
    expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.setLike).toHaveBeenCalledTimes(1);
  });

  it("does not read the page again after a like, but does after anything else", () => {
    const args = (formMethod: string | undefined) =>
      ({ formMethod, defaultShouldRevalidate: true }) as unknown as Parameters<
        typeof shouldRevalidate
      >[0];

    expect(shouldRevalidate(args("POST"))).toBe(false);
    expect(shouldRevalidate(args(undefined))).toBe(true);
  });
});
