import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.sagas.$id";
import { action, loader } from "./admin.sagas.$id";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readAdminWrite: vi.fn(),
  getSagaForAdmin: vi.fn(),
  setSagaStatus: vi.fn(),
  renameSaga: vi.fn(),
  addSagaMember: vi.fn(),
  removeSagaMember: vi.fn(),
  moveSagaMember: vi.fn(),
  getClerkKeys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/auth/admin-write", () => ({
  readAdminWrite: mocks.readAdminWrite,
}));
vi.mock("~server/db/sagas-admin", () => ({
  getSagaForAdmin: mocks.getSagaForAdmin,
  setSagaStatus: mocks.setSagaStatus,
  renameSaga: mocks.renameSaga,
  addSagaMember: mocks.addSagaMember,
  removeSagaMember: mocks.removeSagaMember,
  moveSagaMember: mocks.moveSagaMember,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const id = "0199a3c2-7d4e-7b1a-8c3f-1a2b3c4d5e6f";
const db = { fake: "database" };

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys.mockReset().mockReturnValue({ publishableKey: "pk" });
  mocks.getSagaForAdmin
    .mockReset()
    .mockResolvedValue({ saga: { id }, members: [{ qid: "Q1" }] });
  mocks.setSagaStatus.mockReset().mockResolvedValue(true);
  mocks.renameSaga.mockReset().mockResolvedValue(true);
  mocks.addSagaMember
    .mockReset()
    .mockResolvedValue({ found: true, added: true });
  mocks.removeSagaMember.mockReset().mockResolvedValue(true);
  mocks.moveSagaMember.mockReset().mockResolvedValue(true);
  mocks.readAdminWrite.mockReset();
});

const load = (rawId = id, search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/admin/sagas/${rawId}${search}`),
    params: { id: rawId },
    context: {},
  } as unknown as Route.LoaderArgs);

/** Sends a change as the administrator, and gives back where the page went. */
async function submit(form: Record<string, string>, rawId = id) {
  mocks.readAdminWrite.mockResolvedValue({ user: { id: "admin-1" }, form });
  const response = (await action({
    request: new Request(`https://sagashelf.app/admin/sagas/${rawId}`, {
      method: "POST",
    }),
    params: { id: rawId },
    context: {},
  } as unknown as Route.ActionArgs)) as Response;
  return { response, to: response.headers.get("Location") };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as { init?: { status: number } };
  }
  throw new Error("Expected a refusal");
}

describe("the page of a saga of the administration (SAG-92)", () => {
  it("asks for an administrator, and gives the saga with all its works", async () => {
    const result = await load();

    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mocks.getSagaForAdmin).toHaveBeenCalledWith(db, id);
    expect(result).toMatchObject({
      saga: { id },
      members: [{ qid: "Q1" }],
      error: null,
    });
  });

  it("is a 404 for an address that is not an id and for a saga that does not exist, and a 503 with no Clerk keys", async () => {
    expect((await refusal(load("not-an-id"))).init?.status).toBe(404);
    expect(mocks.getSagaForAdmin).not.toHaveBeenCalled();

    mocks.getSagaForAdmin.mockResolvedValue(null);
    expect((await refusal(load())).init?.status).toBe(404);

    mocks.getClerkKeys.mockReturnValue(null);
    expect((await refusal(load())).init?.status).toBe(503);
  });

  it("reads nothing for a person who is not an administrator", async () => {
    mocks.requireRole.mockRejectedValue({ init: { status: 403 } });

    expect((await refusal(load())).init?.status).toBe(403);
    expect(mocks.getSagaForAdmin).not.toHaveBeenCalled();
  });
});

describe("the changes to a saga (SAG-92)", () => {
  it("publishes and unpublishes, as the administrator of the session", async () => {
    const published = await submit({ intent: "publish" });
    const unpublished = await submit({ intent: "unpublish" });

    expect(mocks.setSagaStatus).toHaveBeenNthCalledWith(
      1,
      db,
      id,
      "published",
      "admin-1",
    );
    expect(mocks.setSagaStatus).toHaveBeenNthCalledWith(
      2,
      db,
      id,
      "draft",
      "admin-1",
    );
    expect(published.response.status).toBe(303);
    expect(published.to).toBe(`/admin/sagas/${id}`);
    expect(unpublished.to).toBe(`/admin/sagas/${id}`);
  });

  it("renames, adding and removing and moving as asked", async () => {
    await submit({ intent: "rename", titleEs: "Uno", titleEn: "One" });
    await submit({ intent: "add", qid: "q22126305" });
    await submit({ intent: "remove", qid: "Q5" });
    await submit({ intent: "move", qid: "Q5", direction: "down" });

    expect(mocks.renameSaga).toHaveBeenCalledWith(
      db,
      id,
      { es: "Uno", en: "One" },
      "admin-1",
    );
    expect(mocks.addSagaMember).toHaveBeenCalledWith(
      db,
      id,
      "Q22126305",
      "admin-1",
    );
    expect(mocks.removeSagaMember).toHaveBeenCalledWith(
      db,
      id,
      "Q5",
      "admin-1",
    );
    expect(mocks.moveSagaMember).toHaveBeenCalledWith(
      db,
      id,
      "Q5",
      "down",
      "admin-1",
    );
  });

  it("says why a change did not happen, and goes back to the page", async () => {
    mocks.addSagaMember.mockResolvedValue({ found: true, added: false });
    expect((await submit({ intent: "add", qid: "Q1" })).to).toBe(
      `/admin/sagas/${id}?error=already_there`,
    );

    mocks.addSagaMember.mockResolvedValue({ found: false, added: false });
    expect((await submit({ intent: "add", qid: "Q1" })).to).toBe(
      `/admin/sagas/${id}?error=not_found`,
    );

    mocks.setSagaStatus.mockResolvedValue(false);
    expect((await submit({ intent: "publish" })).to).toBe(
      `/admin/sagas/${id}?error=not_found`,
    );

    mocks.moveSagaMember.mockResolvedValue(false);
    expect(
      (await submit({ intent: "move", qid: "Q1", direction: "up" })).to,
    ).toBe(`/admin/sagas/${id}?error=nothing_to_move`);

    mocks.removeSagaMember.mockResolvedValue(false);
    expect((await submit({ intent: "remove", qid: "Q1" })).to).toBe(
      `/admin/sagas/${id}?error=not_found`,
    );

    mocks.renameSaga.mockResolvedValue(false);
    expect(
      (await submit({ intent: "rename", titleEs: "a", titleEn: "b" })).to,
    ).toBe(`/admin/sagas/${id}?error=not_found`);
  });

  it("writes nothing for a form it does not understand, or one that carries a field it does not know", async () => {
    const forms: Record<string, string>[] = [
      { intent: "delete" },
      { intent: "add", qid: "not an item" },
      { intent: "move", qid: "Q1", direction: "sideways" },
      { intent: "publish", status: "published" },
      {},
    ];
    for (const form of forms) {
      const { to } = await submit(form);

      expect(to).toBe(`/admin/sagas/${id}?error=invalid_request`);
    }
    for (const change of [
      mocks.setSagaStatus,
      mocks.renameSaga,
      mocks.addSagaMember,
      mocks.removeSagaMember,
      mocks.moveSagaMember,
    ]) {
      expect(change).not.toHaveBeenCalled();
    }
  });

  it("is a 404 for an address that is not an id, and writes nothing", async () => {
    mocks.readAdminWrite.mockResolvedValue({
      user: { id: "admin-1" },
      form: { intent: "publish" },
    });

    const thrown = await refusal(
      action({
        request: new Request("https://sagashelf.app/admin/sagas/nope", {
          method: "POST",
        }),
        params: { id: "nope" },
        context: {},
      } as unknown as Route.ActionArgs),
    );

    expect(thrown.init?.status).toBe(404);
    expect(mocks.setSagaStatus).not.toHaveBeenCalled();
  });

  it("lets the refusals of the write checks through, and writes nothing", async () => {
    const refused = { init: { status: 403 } };
    mocks.readAdminWrite.mockRejectedValue(refused);

    const thrown = await refusal(
      action({
        request: new Request(`https://sagashelf.app/admin/sagas/${id}`, {
          method: "POST",
        }),
        params: { id },
        context: {},
      } as unknown as Route.ActionArgs),
    );

    expect(thrown).toBe(refused);
    expect(mocks.setSagaStatus).not.toHaveBeenCalled();
  });
});
