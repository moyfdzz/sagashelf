import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoaderFunctionArgs } from "react-router";

import { requireUser } from "./require";

const mocks = vi.hoisted(() => ({
  getClerkKeys: vi.fn(),
  getAuth: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("@clerk/backend", () => ({ createClerkClient: vi.fn() }));
vi.mock("../runtime-env", () => ({
  getClerkKeys: mocks.getClerkKeys,
  getDb: mocks.getDb,
}));

const args = (method = "POST") =>
  ({
    request: new Request("https://sagashelf.app/settings/delete", {
      method,
      body: "intent=delete",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
    params: {},
    context: {},
  }) as unknown as LoaderFunctionArgs;

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as {
      init?: { status: number };
      status?: number;
      headers?: Headers;
    };
  }
  throw new Error("Expected a refusal");
}

beforeEach(() => {
  mocks.getClerkKeys.mockReset().mockReturnValue({ secretKey: "x" });
  mocks.getAuth.mockReset().mockResolvedValue({ userId: null });
  mocks.getDb.mockReset();
});

// A refusal leaves the body alone: the Worker entry drops what is left of it before any answer
// goes out (`answerAndDrain`, SAG-69), so nothing here has to remember it (SAG-73).
describe("requireUser", () => {
  it("says the deployment has no keys, without touching the body", async () => {
    mocks.getClerkKeys.mockReturnValue(null);
    const call = args();

    const thrown = await refusal(requireUser(call));

    expect(thrown.init?.status).toBe(503);
    expect(call.request.bodyUsed).toBe(false);
  });

  it("sends a visitor to sign in, without touching the body", async () => {
    const call = args();

    const thrown = await refusal(requireUser(call));

    // A redirect to the sign-in page, a whole new document.
    expect(thrown.status).toBe(302);
    expect(call.request.bodyUsed).toBe(false);
  });

  it("refuses a person that has no account, without touching the body", async () => {
    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    });
    const call = args();

    const thrown = await refusal(requireUser(call));

    expect(thrown.init?.status).toBe(403);
    expect(call.request.bodyUsed).toBe(false);
  });

  it("lets the person go in, and the body is for the route to read", async () => {
    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "u1", clerkId: "user_1", role: "user" }],
          }),
        }),
      }),
    });

    const call = args();

    await expect(requireUser(call)).resolves.toMatchObject({ id: "u1" });
    expect(call.request.bodyUsed).toBe(false);
  });
});
