import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.username";
import { action, loader } from "./settings.username";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDb: vi.fn(),
  getProfile: vi.fn(),
  isUsernameTaken: vi.fn(),
  claimUsernameChange: vi.fn(),
  releaseUsernameChange: vi.fn(),
  applyUsername: vi.fn(),
  updateUser: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ users: { updateUser: mocks.updateUser } }),
}));
vi.mock("~server/runtime-env", () => ({
  getDb: mocks.getDb,
  getClerkKeys: () => ({
    publishableKey: "pk_test_for_the_tests",
    secretKey: "sk_test_for_the_tests",
  }),
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("~server/db/profile", () => ({ getProfile: mocks.getProfile }));
vi.mock("~server/db/username", () => ({
  isUsernameTaken: mocks.isUsernameTaken,
  claimUsernameChange: mocks.claimUsernameChange,
  releaseUsernameChange: mocks.releaseUsernameChange,
  applyUsername: mocks.applyUsername,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };
const clerkTime = Date.UTC(2026, 9, 25, 12, 0, 0);

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.getProfile.mockReset().mockResolvedValue({ username: "ana_reads" });
  mocks.isUsernameTaken.mockReset().mockResolvedValue(false);
  mocks.claimUsernameChange
    .mockReset()
    .mockResolvedValue({ ok: true, previous: null });
  mocks.releaseUsernameChange.mockReset().mockResolvedValue(undefined);
  mocks.applyUsername.mockReset().mockResolvedValue(true);
  mocks.updateUser.mockReset().mockResolvedValue({ updatedAt: clerkTime });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function submit(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const request = new Request("http://localhost/settings/username", {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

type Answer = {
  data: { ok?: boolean; error?: string; username?: string };
  init?: { status?: number };
};
const answer = (value: unknown) => value as Answer;

describe("POST /settings/username", () => {
  it("changes the name in Clerk, then here with Clerk's time", async () => {
    const result = await submit({ username: "ana_new" });

    expect(mocks.claimUsernameChange).toHaveBeenCalledWith(
      db,
      "user-from-session",
    );
    // The Clerk id comes from the session, never from the form.
    expect(mocks.updateUser).toHaveBeenCalledWith("clerk_1", {
      username: "ana_new",
    });
    expect(mocks.applyUsername).toHaveBeenCalledWith(
      db,
      "user-from-session",
      "ana_new",
      new Date(clerkTime),
    );
    expect(answer(result).data).toEqual({ ok: true, username: "ana_new" });
  });

  it("does not count the name the person already has as a change", async () => {
    const result = await submit({ username: "ana_reads" });

    expect(answer(result).data.ok).toBe(true);
    expect(mocks.claimUsernameChange).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a malformed name before anything else", async () => {
    const result = await submit({ username: "12345" });

    expect(answer(result).data.error).toBe("invalid");
    expect(answer(result).init?.status).toBe(400);
    expect(mocks.claimUsernameChange).not.toHaveBeenCalled();
  });

  it("answers the same for a reserved name, a taken one and one Clerk refuses", async () => {
    const reserved = await submit({ username: "admin" });
    mocks.isUsernameTaken.mockResolvedValue(true);
    const taken = await submit({ username: "ana_new" });
    mocks.isUsernameTaken.mockResolvedValue(false);
    mocks.updateUser.mockRejectedValue(
      Object.assign(new Error("form_identifier_exists"), { status: 422 }),
    );
    const refused = await submit({ username: "ana_new" });

    for (const result of [reserved, taken, refused]) {
      expect(answer(result).data.error).toBe("unavailable");
      expect(answer(result).init?.status).toBe(409);
    }
    expect(mocks.claimUsernameChange).toHaveBeenCalledTimes(1);
  });

  it("gives the change back when Clerk refuses, so the person can try again", async () => {
    const previous = new Date("2026-09-01T00:00:00Z");
    mocks.claimUsernameChange.mockResolvedValue({ ok: true, previous });
    mocks.updateUser.mockRejectedValue(new Error("clerk down"));

    const result = await submit({ username: "ana_new" });

    expect(answer(result).data.error).toBe("failed");
    expect(answer(result).init?.status).toBe(502);
    expect(mocks.releaseUsernameChange).toHaveBeenCalledWith(
      db,
      "user-from-session",
      previous,
    );
    expect(mocks.applyUsername).not.toHaveBeenCalled();
  });

  it("says to wait when the last change was less than 30 days ago", async () => {
    mocks.claimUsernameChange.mockResolvedValue({
      ok: false,
      reason: "cooldown",
    });

    const result = await submit({ username: "ana_new" });

    expect(answer(result).data.error).toBe("cooldown");
    expect(answer(result).init?.status).toBe(429);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("still answers ok when our write fails: Clerk's event finishes it", async () => {
    mocks.applyUsername.mockRejectedValue(new Error("database down"));

    const result = await submit({ username: "ana_new" });

    expect(answer(result).data.ok).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("refuses a form that carries other fields, such as another account's id", async () => {
    const result = await submit({ username: "ana_new", clerkId: "clerk_x" });

    expect(answer(result).data.error).toBe("invalid");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    const result = await submit(
      { username: "ana_new" },
      { Origin: "http://evil.test" },
    );

    expect(answer(result).init?.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big before reading anything", async () => {
    const result = await submit(
      { username: "ana_new" },
      { "Content-Length": "5000" },
    );

    expect(answer(result).init?.status).toBe(413);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("sends a visitor without a session to sign in, and changes nothing", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/sign-in" },
    });
    mocks.requireUser.mockRejectedValue(redirect);

    await expect(submit({ username: "ana_new" })).rejects.toBe(redirect);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("is rate limited per person", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = await submit({ username: "ana_new" });

    expect((result as Response).status).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain(
      "username:user-from-session",
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("never writes a name or the error text to the logs", async () => {
    mocks.updateUser.mockRejectedValue(new Error("secret ana_new detail"));

    await submit({ username: "ana_new" });

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("ana_new");
    expect(logged).not.toContain("secret");
  });
});

describe("GET /settings/username", () => {
  it("is not a page: only the form changes the name", () => {
    expect(() => loader()).toThrow();
  });
});
