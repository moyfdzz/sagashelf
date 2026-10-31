import { beforeEach, describe, expect, it, vi } from "vitest";

import { readAdminWrite } from "./admin-write";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
}));

vi.mock("./require", () => ({ requireRole: mocks.requireRole }));
vi.mock("../runtime-env", () => ({
  getWriteLimiter: () => ({ limit: mocks.limit }),
}));

beforeEach(() => {
  mocks.requireRole
    .mockReset()
    .mockResolvedValue({ id: "admin-1", clerkId: "c", role: "admin" });
  mocks.limit.mockReset().mockResolvedValue({ success: true });
});

const send = (
  body: string,
  headers: Record<string, string> = {},
  origin = "https://sagashelf.app",
) =>
  readAdminWrite(
    {
      request: new Request("https://sagashelf.app/admin/sagas", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: origin,
          ...headers,
        },
        body,
      }),
      params: {},
      context: {},
    } as never,
    "sagas",
    64,
  );

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as { init?: { status: number }; status?: number };
  }
  throw new Error("Expected a refusal");
}

describe("readAdminWrite", () => {
  it("gives the administrator of the session and the fields of the form", async () => {
    const result = await send("intent=publish");

    expect(result.user.id).toBe("admin-1");
    expect(result.form).toEqual({ intent: "publish" });
    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
  });

  it("limits the writes of each administrator, by name and by person", async () => {
    await send("intent=publish");

    expect(mocks.limit).toHaveBeenCalledWith({
      key: "admin:sagas:admin-1:unknown",
    });
  });

  it("refuses a form from another site before it asks who the person is", async () => {
    const thrown = await refusal(
      send("intent=publish", {}, "https://evil.example"),
    );

    expect(thrown.init?.status).toBe(403);
    expect(mocks.requireRole).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("accepts a form that carries no Origin, as a browser sends it for some requests", async () => {
    const request = new Request("https://sagashelf.app/admin/sagas", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "intent=publish",
    });

    const result = await readAdminWrite(
      { request, params: {}, context: {} } as never,
      "sagas",
      64,
    );

    expect(result.form).toEqual({ intent: "publish" });
  });

  it("refuses a body that says it is too big, and one that is too big and says nothing", async () => {
    const declared = await refusal(
      send("intent=publish", { "Content-Length": "5000" }),
    );
    const real = await refusal(
      send(`intent=rename&titleEn=${"a".repeat(200)}`),
    );

    expect(declared.init?.status).toBe(413);
    expect(real.init?.status).toBe(413);
    expect(mocks.requireRole).not.toHaveBeenCalledTimes(0);
  });

  it("lets the refusal of the guard through: a visitor and a person who is not an administrator write nothing", async () => {
    const forbidden = { init: { status: 403 } };
    mocks.requireRole.mockRejectedValue(forbidden);

    const thrown = await refusal(send("intent=publish"));

    expect(thrown).toBe(forbidden);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("answers 429 when the person is over the limit, and reads nothing", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const thrown = (await refusal(
      send("intent=publish"),
    )) as unknown as Response;

    expect(thrown.status).toBe(429);
  });
});
