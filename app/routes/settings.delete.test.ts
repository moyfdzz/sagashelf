import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/settings.delete";
import { action, loader } from "./settings.delete";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  has: vi.fn(),
  getDb: vi.fn(),
  getProfile: vi.fn(),
  eraseAccount: vi.fn(),
  deleteUser: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("@clerk/react-router/server", () => ({
  getAuth: async () => ({ has: mocks.has }),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({ users: { deleteUser: mocks.deleteUser } }),
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
vi.mock("~server/db/erase-user", () => ({
  eraseAccount: mocks.eraseAccount,
}));

const db = { fake: "database" };
const session = { id: "user-from-session", clerkId: "clerk_1", role: "user" };

beforeEach(() => {
  mocks.requireUser.mockReset().mockResolvedValue(session);
  mocks.has.mockReset().mockReturnValue(true);
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.getProfile.mockReset().mockResolvedValue({ username: "Ana_Reads" });
  mocks.eraseAccount.mockReset().mockResolvedValue(true);
  mocks.deleteUser.mockReset().mockResolvedValue({});
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const confirmed = { confirm: "ana_reads", understood: "on" };

function submit(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const request = new Request("http://localhost/settings/delete", {
    method: "POST",
    headers: { Origin: "http://localhost", ...headers },
    body: new URLSearchParams(fields),
  });
  return action({ request, context: {} } as unknown as Route.ActionArgs);
}

type Answer = {
  data: { ok?: boolean; error?: string };
  init?: { status?: number };
};
const answer = (value: unknown) => value as Answer;

describe("POST /settings/delete", () => {
  it("deletes the account of the person in the session and sends them home", async () => {
    // The Clerk id comes from the session, never from the form.
    const result = await submit({ ...confirmed });

    expect(mocks.deleteUser).toHaveBeenCalledWith("clerk_1");
    expect(mocks.eraseAccount).toHaveBeenCalledWith(db, "clerk_1");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe("/");
  });

  it("asks for the username without regard to case, and refuses a different one", async () => {
    const wrong = await submit({ confirm: "someone_else", understood: "on" });

    expect(answer(wrong).data.error).toBe("confirm_mismatch");
    expect(answer(wrong).init?.status).toBe(400);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.eraseAccount).not.toHaveBeenCalled();

    await submit({ confirm: "  ANA_READS ", understood: "on" });
    expect(mocks.deleteUser).toHaveBeenCalledTimes(1);
  });

  it("needs the box that says it cannot be undone", async () => {
    const result = await submit({ confirm: "ana_reads" });

    expect(answer(result).data.error).toBe("confirm_mismatch");
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a form that carries other fields, such as another account's id", async () => {
    const result = await submit({ ...confirmed, clerkId: "clerk_victim" });

    expect(answer(result).data.error).toBe("confirm_mismatch");
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("asks the person to sign in again when they did not do it recently", async () => {
    mocks.has.mockReturnValue(false);

    const result = await submit({ ...confirmed });

    expect(mocks.has).toHaveBeenCalledWith({ reverification: "strict" });
    expect(answer(result).data.error).toBe("reauth_required");
    expect(answer(result).init?.status).toBe(403);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.eraseAccount).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    const result = await submit(
      { ...confirmed },
      { Origin: "http://evil.test" },
    );

    expect(answer(result).init?.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a body that is too big before reading anything", async () => {
    const result = await submit({ ...confirmed }, { "Content-Length": "5000" });

    expect(answer(result).init?.status).toBe(413);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("sends a visitor without a session to sign in, and deletes nothing", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/sign-in" },
    });
    mocks.requireUser.mockRejectedValue(redirect);

    await expect(submit({ ...confirmed })).rejects.toBe(redirect);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("is rate limited per person", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const result = await submit({ ...confirmed });

    expect((result as Response).status).toBe(429);
    expect(mocks.limit.mock.calls[0]?.[0].key).toContain(
      "delete:user-from-session",
    );
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("erases nothing when Clerk refuses, so the person can try again", async () => {
    mocks.deleteUser.mockRejectedValue(new Error("clerk down"));

    const result = await submit({ ...confirmed });

    expect(answer(result).data.error).toBe("failed");
    expect(answer(result).init?.status).toBe(502);
    expect(mocks.eraseAccount).not.toHaveBeenCalled();
  });

  it("still sends the person home when our erasure fails: Clerk's event finishes it", async () => {
    mocks.eraseAccount.mockRejectedValue(new Error("database down"));

    const result = await submit({ ...confirmed });

    expect((result as Response).status).toBe(302);
    expect(console.error).toHaveBeenCalled();
  });

  it("never writes the username or the error text to the logs", async () => {
    mocks.eraseAccount.mockRejectedValue(new Error("secret ana_reads detail"));

    await submit({ ...confirmed });

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("ana_reads");
    expect(logged).not.toContain("secret");
  });
});

describe("GET /settings/delete", () => {
  it("is not a page: only the form deletes", () => {
    expect(() => loader()).toThrow();
  });
});
