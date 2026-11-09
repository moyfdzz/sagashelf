import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/u.$username.$kind";
import { headers, loader, meta } from "./u.$username.$kind";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getDb: vi.fn(),
  findViewableProfile: vi.fn(),
  listFollowers: vi.fn(),
  listFollowing: vi.fn(),
  listFriends: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/runtime-env", () => ({ getDb: mocks.getDb }));
vi.mock("~server/db/profile-lookup", () => ({
  findViewableProfile: mocks.findViewableProfile,
}));
vi.mock("~server/db/people-lists", () => ({
  maxPage: 100,
  listFollowers: mocks.listFollowers,
  listFollowing: mocks.listFollowing,
  listFriends: mocks.listFriends,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const db = { fake: "database" };
// What the loader reads once and hands to the list, so the list does not read the profile again.
const viewable = {
  owner: { id: "owner-id", username: "ana_reads", displayName: "Ana" },
  relationship: "stranger",
};

const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };

const page = (usernames: string[], hasMore = false) => ({
  people: usernames.map((username) => ({
    username,
    displayName: username === "ben_one" ? "Ben" : null,
    avatarUrl: "https://img.clerk.com/x",
  })),
  hasMore,
});

beforeEach(() => {
  mocks.getOptionalUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.findViewableProfile.mockReset().mockResolvedValue(viewable);
  mocks.listFollowers.mockReset().mockResolvedValue(page(["ben_one"]));
  mocks.listFollowing.mockReset().mockResolvedValue(page(["cat_one"]));
  mocks.listFriends.mockReset().mockResolvedValue(page(["dan_one"]));
});

const load = (kind: string, search = "", username = "ana_reads") =>
  loader({
    request: new Request(`http://localhost/u/${username}/${kind}${search}`),
    params: { username, kind },
    context: {},
  } as unknown as Route.LoaderArgs);

type Thrown = { init?: { status?: number; headers?: Record<string, string> } };

describe("the lists of people of a profile (SAG-107)", () => {
  it.each([
    ["followers", () => mocks.listFollowers],
    ["following", () => mocks.listFollowing],
    ["friends", () => mocks.listFriends],
  ])(
    "lists the %s as the person of the session, page 1 by default",
    async (kind, which) => {
      const result = await load(kind);

      expect(which()).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
        1,
        viewable,
      );
      expect(result.kind).toBe(kind);
      expect(result.people).toHaveLength(1);
      expect(result.page).toBe(1);
    },
  );

  it("asks as a visitor when there is no session", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);

    await load("followers");

    expect(mocks.findViewableProfile).toHaveBeenCalledWith(
      db,
      null,
      "ana_reads",
    );
    expect(mocks.listFollowers).toHaveBeenCalledWith(
      db,
      null,
      "ana_reads",
      1,
      viewable,
    );
  });

  it("answers 404, private and not cached, for a profile the person may not see, and reads no list", async () => {
    mocks.findViewableProfile.mockResolvedValue(null);

    const thrown = (await load("followers").catch((e: unknown) => e)) as Thrown;

    expect(thrown.init?.status).toBe(404);
    expect(thrown.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    expect(mocks.listFollowers).not.toHaveBeenCalled();
  });

  it("answers the same 404 when the list itself says it is hidden", async () => {
    mocks.listFollowers.mockResolvedValue(null);

    await expect(load("followers")).rejects.toMatchObject({
      init: { status: 404 },
    });
  });

  it.each(["other", "FOLLOWERS", "followers/x", "", "friend"])(
    "answers 404 for the kind %j without opening the database",
    async (kind) => {
      await expect(load(kind)).rejects.toMatchObject({ init: { status: 404 } });
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it.each(["ab", "has space", "a/b"])(
    "answers 404 for the address %j without opening the database",
    async (username) => {
      await expect(load("followers", "", username)).rejects.toMatchObject({
        init: { status: 404 },
      });
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  describe("the page asked for", () => {
    it.each([
      ["?page=3", 3],
      ["?page=1", 1],
      ["?page=0", 1],
      ["?page=-2", 1],
      ["?page=2.5", 1],
      ["?page=abc", 1],
      ["?page=", 1],
      ["?page=999999", 100],
    ])("reads %s as page %i", async (search, want) => {
      const result = await load("followers", search);

      expect(result.page).toBe(want);
      expect(mocks.listFollowers).toHaveBeenCalledWith(
        db,
        "user-from-session",
        "ana_reads",
        want,
        viewable,
      );
    });

    it("says whether there is a next page", async () => {
      mocks.listFollowers.mockResolvedValue(page(["ben_one"], true));

      expect((await load("followers")).hasMore).toBe(true);
    });
  });

  it("gives the page only the username, the name and a picture that is an HTTPS address", async () => {
    mocks.listFollowers.mockResolvedValue({
      people: [
        { username: "ben_one", displayName: "Ben", avatarUrl: "javascript:x" },
        { username: "cat_one", displayName: null, avatarUrl: null },
      ],
      hasMore: false,
    });

    const result = await load("followers");

    expect(result.people).toEqual([
      { username: "ben_one", displayName: "Ben", avatarUrl: null },
      { username: "cat_one", displayName: null, avatarUrl: null },
    ]);
  });

  it("is private and not indexed", () => {
    const merged = headers({
      loaderHeaders: new Headers({ "Cache-Control": "public, max-age=60" }),
    } as unknown as Route.HeadersArgs);

    expect(merged.get("Cache-Control")).toBe("private, no-store");
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});
