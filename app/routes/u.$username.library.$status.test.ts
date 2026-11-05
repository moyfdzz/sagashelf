import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/u.$username.library.$status";
import { headers, loader, meta } from "./u.$username.library.$status";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getDb: vi.fn(),
  findViewableProfile: vi.fn(),
  getProfileSectionPage: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/runtime-env", () => ({ getDb: mocks.getDb }));
vi.mock("~server/db/profile-lookup", () => ({
  findViewableProfile: mocks.findViewableProfile,
}));
vi.mock("~server/db/profile-library", () => ({
  maxSectionPage: 100,
  profileStatuses: ["in_progress", "planned", "completed"],
  getProfileSectionPage: mocks.getProfileSectionPage,
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
const counts = { all: 3, anime: 0, movie: 2, series: 0, book: 1, manga: 0 };

beforeEach(() => {
  mocks.getOptionalUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.findViewableProfile.mockReset().mockResolvedValue({
    owner: { id: "owner-id", username: "ana_reads", privacy: "public" },
    relationship: "stranger",
  });
  mocks.getProfileSectionPage.mockReset().mockResolvedValue({
    entries: [
      {
        mediaId: "11111111-1111-4111-8111-111111111111",
        title: "A movie",
        type: "movie",
        year: 2020,
        imageUrl: null,
        score: 8,
      },
    ],
    hasMore: true,
    counts,
  });
});

const load = (status: string, search = "", username = "ana_reads") =>
  loader({
    request: new Request(
      `http://localhost/u/${username}/library/${status}${search}`,
    ),
    params: { username, status },
    context: {},
  } as unknown as Route.LoaderArgs);

type Thrown = { init?: { status?: number; headers?: Record<string, string> } };

async function statusOf(request: Promise<unknown>) {
  const thrown = (await request.catch((error: unknown) => error)) as Thrown;
  return thrown.init;
}

describe("the page of a section of a profile (SAG-127)", () => {
  it("asks for the section of the verified viewer, with the level of the profile", async () => {
    const result = await load("completed");

    expect(mocks.findViewableProfile).toHaveBeenCalledWith(
      db,
      "user-from-session",
      "ana_reads",
    );
    expect(mocks.getProfileSectionPage).toHaveBeenCalledWith(
      db,
      "owner-id",
      "public",
      "stranger",
      { status: "completed", type: null, page: 1, locale: "en" },
    );
    expect(result).toMatchObject({
      username: "ana_reads",
      status: "completed",
      type: null,
      page: 1,
      hasMore: true,
    });
    expect(result.entries[0]).toMatchObject({ title: "A movie", score: 8 });
  });

  it("gives a tab for all and for each type, with what the viewer may see", async () => {
    const { tabs } = await load("planned");

    expect(tabs).toEqual([
      { type: null, count: 3 },
      { type: "anime", count: 0 },
      { type: "movie", count: 2 },
      { type: "series", count: 0 },
      { type: "book", count: 1 },
      { type: "manga", count: 0 },
    ]);
  });

  it("reads the type and the page of the address", async () => {
    await load("in_progress", "?type=book&page=3");

    expect(mocks.getProfileSectionPage).toHaveBeenCalledWith(
      db,
      "owner-id",
      "public",
      "stranger",
      { status: "in_progress", type: "book", page: 3, locale: "en" },
    );
  });

  it("a visitor asks with no viewer", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);

    await load("completed");

    expect(mocks.findViewableProfile).toHaveBeenCalledWith(
      db,
      null,
      "ana_reads",
    );
  });

  it("stops at the last page", async () => {
    const { page } = await load("completed", "?page=500");

    expect(page).toBe(100);
  });

  it.each([
    ["a section that does not exist", "paused", ""],
    ["a section written differently", "COMPLETED", ""],
    ["a type with no tab", "completed", "?type=custom"],
    ["a type that does not exist", "completed", "?type=other"],
  ])(
    "answers 404 for %s, before reading anything",
    async (_, status, search) => {
      const init = await statusOf(load(status, search));

      expect(init?.status).toBe(404);
      expect(init?.headers?.["Cache-Control"]).toMatch(/private/);
      expect(mocks.findViewableProfile).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for an address that cannot be a username", async () => {
    const init = await statusOf(load("completed", "", "ab"));

    expect(init?.status).toBe(404);
    expect(mocks.findViewableProfile).not.toHaveBeenCalled();
  });

  it("gives the same 404 as a missing profile to a person who may not see it, and reads no title", async () => {
    mocks.findViewableProfile.mockResolvedValue(null);

    const init = await statusOf(load("completed"));

    expect(init?.status).toBe(404);
    expect(mocks.getProfileSectionPage).not.toHaveBeenCalled();
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
