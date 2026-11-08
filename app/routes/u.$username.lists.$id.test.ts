import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/u.$username.lists.$id";
import { headers, loader, meta } from "./u.$username.lists.$id";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getDb: vi.fn(),
  findViewableProfile: vi.fn(),
  getViewableList: vi.fn(),
  listViewableItems: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/runtime-env", () => ({ getDb: mocks.getDb }));
vi.mock("~server/db/profile-lookup", () => ({
  findViewableProfile: mocks.findViewableProfile,
}));
vi.mock("~server/db/profile-lists", async () => ({
  // The rule of the levels is pure, so the real one is used and only the database is replaced.
  visibleListLevels: (
    await vi.importActual<typeof import("~server/db/profile-lists")>(
      "~server/db/profile-lists",
    )
  ).visibleListLevels,
  getViewableList: mocks.getViewableList,
  listViewableItems: mocks.listViewableItems,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
  getLocale: () => mocks.locale,
}));

const db = { fake: "database" };
const listId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e70";
const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e71";

const head = (overrides: Record<string, unknown> = {}) => ({
  id: "owner-id",
  username: "ana_reads",
  displayName: "Ana",
  privacy: "public",
  ...overrides,
});

beforeEach(() => {
  mocks.locale = "es";
  mocks.getOptionalUser.mockReset().mockResolvedValue({ id: "viewer-id" });
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.findViewableProfile
    .mockReset()
    .mockResolvedValue({ owner: head(), relationship: "stranger" });
  mocks.getViewableList.mockReset().mockResolvedValue({
    id: listId,
    title: "Best sci-fi",
    description: "Space",
    visibility: "public",
    items: 1,
    updatedAt: new Date(),
  });
  mocks.listViewableItems
    .mockReset()
    .mockResolvedValue([
      { mediaId, type: "movie", title: "Arrival", year: 2016 },
    ]);
});

const load = (username = "ana_reads", id = listId) =>
  loader({
    request: new Request(`http://localhost/u/${username}/lists/${id}`),
    params: { username, id },
    context: {},
  } as unknown as Route.LoaderArgs);

type Thrown = { init?: { status?: number; headers?: Record<string, string> } };

/** What a loader threw: the answer of `data(...)`. */
async function thrownBy(promise: Promise<unknown>): Promise<Thrown> {
  try {
    await promise;
  } catch (thrown) {
    return thrown as Thrown;
  }
  throw new Error("The loader was expected to throw");
}

async function status(promise: Promise<unknown>) {
  return (await thrownBy(promise)).init?.status;
}

describe("the page of a list of somebody else (SAG-113, ADR-045)", () => {
  it("gives the list and its titles with links, and nothing of the notes or the level", async () => {
    const result = await load();

    expect(result.list).toEqual({
      id: listId,
      title: "Best sci-fi",
      description: "Space",
      items: 1,
    });
    expect(result.titles).toEqual([
      {
        mediaId,
        title: "Arrival",
        type: "movie",
        year: 2016,
        href: `/media/movie/arrival-${mediaId}`,
      },
    ]);
    expect(result.isOwner).toBe(false);
    expect(JSON.stringify(result)).not.toContain("note");
    expect(JSON.stringify(result)).not.toContain("visibility");
  });

  it("is the page of a visitor too: it asks for the session without requiring one", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);
    mocks.findViewableProfile.mockResolvedValue({
      owner: head(),
      relationship: "signed_out",
    });

    await load();

    expect(mocks.findViewableProfile).toHaveBeenCalledWith(
      db,
      null,
      "ana_reads",
    );
    expect(mocks.getViewableList).toHaveBeenCalledWith(db, "owner-id", listId, [
      "public",
    ]);
  });

  it.each([
    ["stranger", "public", ["public"]],
    ["friend", "public", ["public", "friends"]],
    ["friend", "friends", ["public", "friends"]],
    ["owner", "friends", ["public", "friends", "private"]],
  ])(
    "asks for the list of a %s of a %s profile with the levels %j only, for the list and its titles",
    async (relationship, privacy, expected) => {
      mocks.findViewableProfile.mockResolvedValue({
        owner: head({ privacy }),
        relationship,
      });

      await load();

      expect(mocks.getViewableList).toHaveBeenCalledWith(
        db,
        "owner-id",
        listId,
        expected,
      );
      expect(mocks.listViewableItems).toHaveBeenCalledWith(
        db,
        "owner-id",
        listId,
        expected,
        "es",
      );
    },
  );

  it("asks for the list and its titles together, not one after the other", async () => {
    let release: (list: unknown) => void = () => {};
    mocks.getViewableList.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const pending = load();
    // The list has not answered yet, and the titles were already asked for.
    await vi.waitFor(() => expect(mocks.listViewableItems).toHaveBeenCalled());
    release({ id: listId, title: "Best sci-fi", description: null, items: 1 });

    expect((await pending).titles).toHaveLength(1);
  });

  it("shows a title with no page of its own as plain text, with no kind and no link", async () => {
    mocks.listViewableItems.mockResolvedValue([
      { mediaId, type: "custom", title: "My notes", year: null },
    ]);

    expect((await load()).titles).toEqual([
      { mediaId, title: "My notes", type: null, year: null, href: null },
    ]);
  });

  it("shows the owner the link to edit", async () => {
    mocks.findViewableProfile.mockResolvedValue({
      owner: head(),
      relationship: "owner",
    });

    expect((await load()).isOwner).toBe(true);
  });

  it("asks for the titles in the language of the page", async () => {
    mocks.locale = "en";

    await load();

    expect(mocks.listViewableItems).toHaveBeenCalledWith(
      db,
      "owner-id",
      listId,
      ["public"],
      "en",
    );
  });

  describe("is the same 404 for everything that may not be seen", () => {
    it("a profile that may not be seen, does not exist, is erased or is blocked", async () => {
      mocks.findViewableProfile.mockResolvedValue(null);

      expect(await status(load())).toBe(404);
      expect(mocks.getViewableList).not.toHaveBeenCalled();
    });

    it("a list the levels do not allow, or that is not there, or is of somebody else", async () => {
      mocks.getViewableList.mockResolvedValue(null);

      // The titles are read with the same levels, so for such a list they are none; the answer is
      // the 404 whatever they are.
      mocks.listViewableItems.mockResolvedValue([
        { mediaId, type: "movie", title: "Arrival", year: 2016 },
      ]);
      expect(await status(load())).toBe(404);
    });

    it("a username that is not a username, and an id that is not an id, before the database", async () => {
      expect(await status(load("a b"))).toBe(404);
      expect(await status(load("ana_reads", "not-an-id"))).toBe(404);
      expect(mocks.getDb).not.toHaveBeenCalled();
    });

    it("answers with private headers, so a shared cache keeps nothing", async () => {
      mocks.findViewableProfile.mockResolvedValue(null);
      const thrown = await thrownBy(load());
      expect(thrown.init?.headers?.["Cache-Control"]).toBe("private, no-store");
    });
  });

  it("is not for a shared cache and not for a search engine", () => {
    expect(headers).toBeDefined();
    expect(
      meta({ loaderData: { title: "x" } } as Route.MetaArgs),
    ).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});
