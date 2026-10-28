import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoaderFunctionArgs } from "react-router";

import { requireUser } from "./require";

const mocks = vi.hoisted(() => ({
  getClerkKeys: vi.fn(),
  getAuth: vi.fn(),
  getDb: vi.fn(),
  drainBody: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("@clerk/backend", () => ({ createClerkClient: vi.fn() }));
vi.mock("../runtime-env", () => ({
  getClerkKeys: mocks.getClerkKeys,
  getDb: mocks.getDb,
}));
vi.mock("../http/body", () => ({ drainBody: mocks.drainBody }));

const args = (method = "POST") =>
  ({
    request: new Request("https://sagashelf.app/settings/delete", { method }),
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
  mocks.drainBody.mockReset().mockResolvedValue(undefined);
  mocks.getDb.mockReset();
});

describe("requireUser", () => {
  it("reads what is left of the body before it says the deployment has no keys", async () => {
    mocks.getClerkKeys.mockReturnValue(null);
    const call = args();

    const thrown = await refusal(requireUser(call));

    expect(thrown.init?.status).toBe(503);
    expect(mocks.drainBody).toHaveBeenCalledWith(call.request);
  });

  it("reads it before it sends a visitor to sign in", async () => {
    const call = args();

    const thrown = await refusal(requireUser(call));

    // A redirect to the sign-in page, a whole new document.
    expect(thrown.status).toBe(302);
    expect(mocks.drainBody).toHaveBeenCalledWith(call.request);
  });

  it("reads it before it refuses a person that has no account", async () => {
    mocks.getAuth.mockResolvedValue({ userId: "user_1" });
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    });
    const call = args();

    const thrown = await refusal(requireUser(call));

    expect(thrown.init?.status).toBe(403);
    expect(mocks.drainBody).toHaveBeenCalledWith(call.request);
  });

  it("does not read anything when the person may go in", async () => {
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

    await expect(requireUser(args())).resolves.toMatchObject({ id: "u1" });
    expect(mocks.drainBody).not.toHaveBeenCalled();
  });
});
