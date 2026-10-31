import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.sagas";
import { action, headers, loader, meta } from "./admin.sagas";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readAdminWrite: vi.fn(),
  listSagasForAdmin: vi.fn(),
  createSaga: vi.fn(),
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
  listSagasForAdmin: mocks.listSagasForAdmin,
  createSaga: mocks.createSaga,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys.mockReset().mockReturnValue({ publishableKey: "pk" });
  mocks.listSagasForAdmin.mockReset().mockResolvedValue([{ id: "s1" }]);
  mocks.createSaga.mockReset().mockResolvedValue("new-id");
  mocks.readAdminWrite.mockReset().mockResolvedValue({
    user: { id: "admin-1" },
    form: { intent: "create", titleEs: "Dune", titleEn: "Dune" },
  });
});

const load = (search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/admin/sagas${search}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

const submit = () =>
  action({
    request: new Request("https://sagashelf.app/admin/sagas", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as unknown as Route.ActionArgs);

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (thrown) {
    return thrown as { init?: { status: number } };
  }
  throw new Error("Expected a refusal");
}

describe("the list of sagas of the administration (SAG-92)", () => {
  it("asks for an administrator, and lists every saga", async () => {
    const result = await load();

    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(result).toMatchObject({
      publishableKey: "pk",
      sagas: [{ id: "s1" }],
      error: null,
    });
  });

  it("reads nothing for a visitor or a person who is not an administrator", async () => {
    const refused = { init: { status: 403 } };
    mocks.requireRole.mockRejectedValue(refused);

    expect(await refusal(load())).toBe(refused);
    expect(mocks.listSagasForAdmin).not.toHaveBeenCalled();
  });

  it("is a 503 when the deployment has no Clerk keys", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    expect((await refusal(load())).init?.status).toBe(503);
    expect(mocks.listSagasForAdmin).not.toHaveBeenCalled();
  });

  it("says why the last change did not happen, only with a reason it knows", async () => {
    expect(await load("?error=slug_taken")).toMatchObject({
      error: "slug_taken",
    });
    expect(await load("?error=%3Cscript%3E")).toMatchObject({ error: null });
  });

  it("is private and not indexed", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});

describe("creating a saga (SAG-92)", () => {
  it("makes a draft with the address of the English name, as the administrator of the session, and opens it", async () => {
    const response = (await submit()) as Response;

    expect(mocks.readAdminWrite).toHaveBeenCalledWith(
      expect.anything(),
      "sagas",
      2048,
    );
    expect(mocks.createSaga).toHaveBeenCalledWith(
      { fake: "database" },
      {
        slug: "dune",
        titles: { es: "Dune", en: "Dune" },
        actorId: "admin-1",
      },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/sagas/new-id");
  });

  it("takes the address from the English name, without accents or symbols", async () => {
    mocks.readAdminWrite.mockResolvedValue({
      user: { id: "admin-1" },
      form: {
        intent: "create",
        titleEs: "El Señor de los Anillos",
        titleEn: "The Lord of the Rings: Saga!",
      },
    });

    await submit();

    expect(mocks.createSaga.mock.calls[0]?.[1].slug).toBe(
      "the-lord-of-the-rings-saga",
    );
  });

  it("says the address is taken when it already exists", async () => {
    mocks.createSaga.mockResolvedValue(null);

    const response = (await submit()) as Response;

    expect(response.headers.get("Location")).toBe(
      "/admin/sagas?error=slug_taken",
    );
  });

  it("writes nothing for a form that is not a saga, or that says another change", async () => {
    for (const form of [
      { intent: "create", titleEs: "", titleEn: "x" },
      { intent: "create", titleEs: "x" },
      { intent: "publish" },
      { intent: "create", titleEs: "x", titleEn: "y", role: "admin" },
    ]) {
      mocks.readAdminWrite.mockResolvedValue({ user: { id: "a" }, form });

      const response = (await submit()) as Response;

      expect(response.headers.get("Location")).toBe(
        "/admin/sagas?error=invalid_request",
      );
    }
    expect(mocks.createSaga).not.toHaveBeenCalled();
  });

  it("lets the refusals of the write checks through, and writes nothing", async () => {
    const refused = { init: { status: 429 } };
    mocks.readAdminWrite.mockRejectedValue(refused);

    expect(await refusal(submit())).toBe(refused);
    expect(mocks.createSaga).not.toHaveBeenCalled();
  });
});
