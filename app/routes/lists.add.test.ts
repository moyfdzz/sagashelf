import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/lists.add";
import { action, loader } from "./lists.add";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  getDb: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  addListItem: vi.fn(),
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/list-items", () => ({ addListItem: mocks.addListItem }));

const db = { fake: "database" };
const listId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const mediaId = "0199a3c2-7d4e-7b1a-8c3f-aaaaaaaaaaa1";

beforeEach(() => {
  mocks.getOptionalUser
    .mockReset()
    .mockResolvedValue({ id: "user-from-session", role: "user" });
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.addListItem.mockReset().mockResolvedValue("added");
});

function submit(
  fields: Record<string, string> = { listId, mediaId },
  requestHeaders: Record<string, string> = {},
) {
  return action({
    request: new Request("http://localhost/lists/add", {
      method: "POST",
      headers: { Origin: "http://localhost", ...requestHeaders },
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs);
}

type Answer = { data: Record<string, unknown>; init?: { status?: number } };
const answer = (value: unknown) => value as Answer;
// Only a `fetch` of the page asks for data; a plain form is a document.
const fetchHeaders = { "Sec-Fetch-Dest": "empty" };

describe("adding a title to a list from its page (SAG-113)", () => {
  it("does not answer a GET", () => {
    expect(() => loader()).toThrowError();
  });

  it("adds for the person of the session, never for a person named in the form", async () => {
    const result = answer(
      await submit({ listId, mediaId, ownerId: "someone" }, fetchHeaders),
    );

    // A field the form does not have is refused, and nothing is written.
    expect(result.init?.status).toBe(400);
    expect(mocks.addListItem).not.toHaveBeenCalled();

    await submit({ listId, mediaId }, fetchHeaders);
    expect(mocks.addListItem).toHaveBeenCalledWith(
      db,
      "user-from-session",
      listId,
      mediaId,
    );
  });

  it.each(["added", "already"])(
    "gives the page data with %s when it asked for data",
    async (outcome) => {
      mocks.addListItem.mockResolvedValue(outcome);

      const result = answer(await submit(undefined, fetchHeaders));

      expect(result.data).toEqual({ ok: true, result: outcome });
    },
  );

  it.each([
    ["limit", 409],
    ["not_found", 404],
  ])("answers %s with %i, as data for the page", async (outcome, status) => {
    mocks.addListItem.mockResolvedValue(outcome);

    const result = answer(await submit(undefined, fetchHeaders));

    expect(result.init?.status).toBe(status);
    expect(result.data).toEqual({ ok: false, error: outcome });
  });

  it("sends a form without JavaScript back to the page it came from", async () => {
    const result = (await submit(undefined, {
      Referer: "http://localhost/media/movie/dune-x",
    })) as Response;

    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe(
      "http://localhost/media/movie/dune-x",
    );
  });

  it("does not follow a Referer from another site", async () => {
    const result = (await submit(undefined, {
      Referer: "https://evil.example/x",
    })) as Response;

    expect(result.headers.get("Location")).toBe("http://localhost/lists/add");
  });

  it("sends a session that ran out to sign in, before the limit and the database", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);

    const result = (await submit()) as Response;

    expect(result.status).toBe(303);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.addListItem).not.toHaveBeenCalled();
  });

  it("refuses a form sent from another site, and one that is too big", async () => {
    const other = answer(
      await submit(undefined, { Origin: "https://evil.example" }),
    );
    const big = answer(
      await submit(undefined, { "Content-Length": String(5 * 1024) }),
    );

    expect(other.init?.status).toBe(403);
    expect(big.init?.status).toBe(413);
    expect(mocks.getOptionalUser).not.toHaveBeenCalled();
  });

  it("is limited per person, and a limited request writes nothing", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = (await submit()) as Response;

    expect(result.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith({
      key: expect.stringContaining("lists:user-from-session"),
    });
    expect(mocks.addListItem).not.toHaveBeenCalled();
  });

  it.each([
    ["a list id that is not an id", { listId: "x", mediaId }],
    ["a title id that is not an id", { listId, mediaId: "x" }],
    ["no title", { listId }],
  ])("refuses %s", async (_name, fields) => {
    const result = answer(await submit(fields, fetchHeaders));

    expect(result.init?.status).toBe(400);
    expect(mocks.addListItem).not.toHaveBeenCalled();
  });
});
