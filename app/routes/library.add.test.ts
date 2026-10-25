import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/library.add";
import { action, loader } from "./library.add";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  addEntry: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({
  getOptionalUser: mocks.getOptionalUser,
}));
vi.mock("~server/db/library", () => ({ addEntry: mocks.addEntry }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));

const mediaId = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";

beforeEach(() => {
  mocks.getOptionalUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.addEntry.mockReset().mockResolvedValue(true);
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

function send(
  fields: Record<string, string> = { mediaId },
  headers: Record<string, string> = {},
) {
  return action({
    request: new Request("https://sagashelf.app/library/add", {
      method: "POST",
      headers: { Origin: "https://sagashelf.app", ...headers },
      body: new URLSearchParams(fields),
    }),
    context: {},
    params: {},
  } as unknown as Route.ActionArgs);
}

// A `data()` answer keeps its status in `init`, a `Response` in `status`; either may be thrown.
async function statusOf(promise: Promise<unknown>) {
  const read = (value: unknown) =>
    (value as { init?: { status: number } }).init?.status ??
    (value as Response).status;
  try {
    return read(await promise);
  } catch (thrown) {
    return read(thrown);
  }
}

describe("adding a title to the library", () => {
  it("adds it for the person of the session and goes to their entry", async () => {
    const response = (await send()) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`/library/${mediaId}`);
    expect(mocks.addEntry).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      mediaId,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("takes the person from the session and never from the form", async () => {
    await statusOf(send({ mediaId, userId: "someone-else" }));

    expect(mocks.addEntry).not.toHaveBeenCalled();
    expect(await statusOf(send({ mediaId, userId: "someone-else" }))).toBe(400);
  });

  it("sends a visitor with no session to sign in and back to the title page", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);

    const response = (await send(
      { mediaId },
      { Referer: "https://sagashelf.app/media/anime/titanes-abc" },
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      `/sign-in?redirectTo=${encodeURIComponent("/media/anime/titanes-abc")}`,
    );
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("does not trust a referer from another site", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);

    const response = (await send(
      { mediaId },
      { Referer: "https://evil.example/media/x" },
    )) as Response;

    expect(response.headers.get("Location")).toBe(
      `/sign-in?redirectTo=${encodeURIComponent("/library/add")}`,
    );
  });

  it("refuses a form sent from another site, before looking at the session", async () => {
    expect(
      await statusOf(send({ mediaId }, { Origin: "https://evil.example" })),
    ).toBe(403);
    expect(mocks.getOptionalUser).not.toHaveBeenCalled();
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big", async () => {
    expect(
      await statusOf(send({ mediaId }, { "Content-Length": "5000" })),
    ).toBe(413);
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("is rate limited per person", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    expect(await statusOf(send())).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain("library:user-1");
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["no title", {}],
    ["a title id that is not an id", { mediaId: "../../x" }],
  ])("answers 400 for %s", async (_name, fields) => {
    expect(await statusOf(send(fields))).toBe(400);
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });

  it("answers 404 when there is no such title", async () => {
    mocks.addEntry.mockResolvedValue(false);

    expect(await statusOf(send())).toBe(404);
  });

  it("is only for a POST", () => {
    expect(() => loader()).toThrowError();
    try {
      loader();
    } catch (thrown) {
      expect((thrown as { init?: { status: number } }).init?.status).toBe(405);
    }
  });
});
