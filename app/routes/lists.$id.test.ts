import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/lists.$id";
import { action, loader } from "./lists.$id";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  keys: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  getOwnList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn(),
  listItemsOf: vi.fn(),
  removeListItem: vi.fn(),
  moveListItem: vi.fn(),
  saveListItemNote: vi.fn(),
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
  getOwnList: mocks.getOwnList,
  updateList: mocks.updateList,
  deleteList: mocks.deleteList,
}));
vi.mock("~server/db/list-items", () => ({
  listItemsOf: mocks.listItemsOf,
  removeListItem: mocks.removeListItem,
  moveListItem: mocks.moveListItem,
  saveListItemNote: mocks.saveListItemNote,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => "en",
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.keys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk_test_for_the_tests" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.getOwnList.mockReset().mockResolvedValue({
    id,
    title: "Best sci-fi",
    description: null,
    visibility: "friends",
    items: 3,
    updatedAt: new Date("2026-11-06T12:00:00Z"),
  });
  mocks.updateList.mockReset().mockResolvedValue("saved");
  mocks.deleteList.mockReset().mockResolvedValue(true);
  mocks.listItemsOf.mockReset().mockResolvedValue([]);
  mocks.removeListItem.mockReset().mockResolvedValue(true);
  mocks.moveListItem.mockReset().mockResolvedValue(true);
  mocks.saveListItemNote.mockReset().mockResolvedValue(true);
});

const load = (listId = id, query = "") =>
  loader({
    request: new Request(`http://localhost/lists/${listId}${query}`),
    params: { id: listId },
    context: {},
  } as unknown as Route.LoaderArgs);

function submit(
  fields: Record<string, string>,
  requestHeaders: Record<string, string> = {},
  listId = id,
) {
  const request = new Request(`http://localhost/lists/${listId}`, {
    method: "POST",
    headers: { Origin: "http://localhost", ...requestHeaders },
    body: new URLSearchParams(fields),
  });
  return action({
    request,
    params: { id: listId },
    context: {},
  } as unknown as Route.ActionArgs);
}

type Answer = {
  data: { error?: string; values?: Record<string, string> };
  init?: { status?: number };
};
const answer = (value: unknown) => value as Answer;

const save = (overrides: Record<string, string> = {}) => ({
  intent: "save",
  title: "Best sci-fi",
  description: "",
  visibility: "public",
  ...overrides,
});

describe("the page of one list (SAG-113)", () => {
  describe("loader", () => {
    it("asks for the list with the id of the address and the person of the session", async () => {
      await load();

      expect(mocks.getOwnList).toHaveBeenCalledWith(
        db,
        "user-from-session",
        id,
      );
    });

    it("gives the page the list, with an empty text for a missing description", async () => {
      const result = await load();

      expect(result.list).toEqual({
        id,
        title: "Best sci-fi",
        description: "",
        visibility: "friends",
        items: 3,
      });
      expect(result.confirming).toBe(false);
    });

    it("opens the confirmation only for the word the page uses", async () => {
      expect((await load(id, "?confirm=1")).confirming).toBe(true);
      expect((await load(id, "?confirm=yes")).confirming).toBe(false);
    });

    it("answers 404 for a list that is not the person's, as for one that does not exist", async () => {
      mocks.getOwnList.mockResolvedValue(null);

      await expect(load()).rejects.toMatchObject({ init: { status: 404 } });
    });

    it("answers 404 for an id that is not an id, and does not ask the database", async () => {
      await expect(load("not-an-id")).rejects.toMatchObject({
        init: { status: 404 },
      });
      expect(mocks.getOwnList).not.toHaveBeenCalled();
    });

    it("sends a visitor to sign in and reads nothing", async () => {
      const redirect = new Response(null, { status: 302 });
      mocks.requireUser.mockRejectedValue(redirect);

      await expect(load()).rejects.toBe(redirect);
      expect(mocks.getOwnList).not.toHaveBeenCalled();
    });
  });

  describe("POST: what stops a request before it does anything", () => {
    it("refuses a body that is too big, without reading who sent it", async () => {
      const result = answer(
        await submit(save(), { "Content-Length": String(5 * 1024) }),
      );

      expect(result.init?.status).toBe(413);
      expect(mocks.requireUser).not.toHaveBeenCalled();
      expect(mocks.updateList).not.toHaveBeenCalled();
    });

    it("refuses a form sent from another site", async () => {
      const result = answer(
        await submit(save(), { Origin: "https://evil.example" }),
      );

      expect(result.init?.status).toBe(403);
      expect(mocks.updateList).not.toHaveBeenCalled();
      expect(mocks.deleteList).not.toHaveBeenCalled();
    });

    it("is limited per person, and a limited request does nothing", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit({ intent: "delete" })) as Response;

      expect(result.status).toBe(429);
      expect(mocks.limit).toHaveBeenCalledWith({
        key: expect.stringContaining("lists:user-from-session"),
      });
      expect(mocks.deleteList).not.toHaveBeenCalled();
    });

    it("answers 404 for an id that is not an id", async () => {
      const result = answer(await submit(save(), {}, "not-an-id"));

      expect(result.init?.status).toBe(404);
      expect(mocks.updateList).not.toHaveBeenCalled();
    });

    it.each([
      [
        "no intent",
        { title: "x", description: "", visibility: "public" } as Record<
          string,
          string
        >,
      ],
      ["an intent that does not exist", save({ intent: "create" })],
      ["an empty title", save({ title: "" })],
      ["a title over 100 characters", save({ title: "a".repeat(101) })],
      ["a field the form does not have", save({ ownerId: "someone-else" })],
    ])("refuses %s", async (_name, fields) => {
      const result = answer(await submit(fields));

      expect(result.init?.status).toBe(400);
      expect(result.data.error).toBe("invalid_request");
      expect(mocks.updateList).not.toHaveBeenCalled();
    });

    it("refuses a delete that carries more than the intent", async () => {
      const result = answer(await submit({ intent: "delete", id: "x" }));

      expect(result.init?.status).toBe(400);
      expect(mocks.deleteList).not.toHaveBeenCalled();
    });
  });

  describe("POST: saving and deleting", () => {
    it("saves for the person of the session, on the list of the address, and shows it saved", async () => {
      const result = (await submit(
        save({
          title: " New name ",
          description: " Why ",
          visibility: "private",
        }),
      )) as Response;

      expect(mocks.updateList).toHaveBeenCalledWith(
        db,
        "user-from-session",
        id,
        { title: "New name", description: "Why", visibility: "private" },
      );
      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe(`/lists/${id}?notice=saved`);
    });

    it.each([
      ["duplicate", 409],
      ["not_found", 404],
    ])("answers %s with %i and what was written", async (outcome, status) => {
      mocks.updateList.mockResolvedValue(outcome);

      const result = answer(await submit(save({ title: "Taken" })));

      expect(result.init?.status).toBe(status);
      expect(result.data.error).toBe(outcome);
      expect(result.data.values?.title).toBe("Taken");
    });

    it("deletes the list of the address for the person of the session and goes to the lists", async () => {
      const result = (await submit({ intent: "delete" })) as Response;

      expect(mocks.deleteList).toHaveBeenCalledWith(
        db,
        "user-from-session",
        id,
      );
      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe("/lists?notice=deleted");
    });

    it("answers 404 when there was nothing to delete", async () => {
      mocks.deleteList.mockResolvedValue(false);

      const result = answer(await submit({ intent: "delete" }));

      expect(result.init?.status).toBe(404);
      expect(result.data.error).toBe("not_found");
    });
  });

  describe("the titles of the list", () => {
    const media = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaaa";

    it("reads them for the person of the session, in the language of the page", async () => {
      mocks.listItemsOf.mockResolvedValue([
        {
          mediaId: media,
          type: "movie",
          title: "Dune",
          year: 2021,
          imageUrl: null,
          note: "Watch with Ana",
        },
      ]);

      const result = await load();

      expect(mocks.listItemsOf).toHaveBeenCalledWith(
        db,
        "user-from-session",
        id,
        "en",
      );
      expect(result.titles).toEqual([
        {
          mediaId: media,
          title: "Dune",
          type: "movie",
          year: 2021,
          note: "Watch with Ana",
          href: `/media/movie/dune-${media}`,
        },
      ]);
    });

    it("reads no titles of a list that is not the person's", async () => {
      mocks.getOwnList.mockResolvedValue(null);

      await expect(load()).rejects.toMatchObject({ init: { status: 404 } });
      expect(mocks.listItemsOf).not.toHaveBeenCalled();
    });

    it("removes a title for the person of the session, from the list of the address", async () => {
      const result = (await submit({
        intent: "remove_item",
        mediaId: media,
      })) as Response;

      expect(mocks.removeListItem).toHaveBeenCalledWith(
        db,
        "user-from-session",
        id,
        media,
      );
      expect(result.status).toBe(303);
      expect(result.headers.get("Location")).toBe(
        `/lists/${id}?notice=removed#titles`,
      );
    });

    it.each([
      ["up", "up"],
      ["down", "down"],
    ])("moves a title %s", async (direction, expected) => {
      const result = (await submit({
        intent: "move_item",
        mediaId: media,
        direction,
      })) as Response;

      expect(mocks.moveListItem).toHaveBeenCalledWith(
        db,
        "user-from-session",
        id,
        media,
        expected,
      );
      expect(result.headers.get("Location")).toBe(
        `/lists/${id}?notice=moved#titles`,
      );
    });

    it("saves a note, and an empty note clears it", async () => {
      await submit({ intent: "note_item", mediaId: media, note: " Gift " });
      await submit({ intent: "note_item", mediaId: media, note: "  " });

      expect(mocks.saveListItemNote).toHaveBeenNthCalledWith(
        1,
        db,
        "user-from-session",
        id,
        media,
        "Gift",
      );
      expect(mocks.saveListItemNote).toHaveBeenNthCalledWith(
        2,
        db,
        "user-from-session",
        id,
        media,
        null,
      );
    });

    it("refuses a note over 500 characters with its own error, and saves nothing", async () => {
      const result = answer(
        await submit({
          intent: "note_item",
          mediaId: media,
          note: "a".repeat(501),
        }),
      );

      expect(result.init?.status).toBe(400);
      expect(result.data.error).toBe("invalid_note");
      expect(result.data.values).toBeUndefined();
      expect(mocks.saveListItemNote).not.toHaveBeenCalled();
    });

    it.each([
      ["a media id that is not an id", { mediaId: "x", direction: "up" }],
      [
        "a direction that does not exist",
        { mediaId: media, direction: "left" },
      ],
      [
        "a field the form does not have",
        { mediaId: media, direction: "up", listId: "x" },
      ],
    ])("refuses a move with %s", async (_name, fields) => {
      const result = answer(await submit({ intent: "move_item", ...fields }));

      expect(result.init?.status).toBe(400);
      expect(mocks.moveListItem).not.toHaveBeenCalled();
    });

    it.each([
      ["remove_item", "removeListItem", {}],
      ["move_item", "moveListItem", { direction: "up" }],
      ["note_item", "saveListItemNote", { note: "x" }],
    ] as const)(
      "answers 404 with its own error when %s finds nothing",
      async (intent, fn, extra) => {
        mocks[fn].mockResolvedValue(false);

        const result = answer(
          await submit({ intent, mediaId: media, ...extra }),
        );

        expect(result.init?.status).toBe(404);
        expect(result.data.error).toBe("item_not_found");
        expect(result.data.values).toBeUndefined();
      },
    );

    it("is limited per person like the rest of the forms of the page", async () => {
      mocks.limit.mockResolvedValue({ success: false });

      const result = (await submit({
        intent: "remove_item",
        mediaId: media,
      })) as Response;

      expect(result.status).toBe(429);
      expect(mocks.removeListItem).not.toHaveBeenCalled();
    });
  });
});
