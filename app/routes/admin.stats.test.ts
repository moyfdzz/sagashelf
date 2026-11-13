import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.stats";
import { headers, loader, meta } from "./admin.stats";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getAdminOverview: vi.fn(),
  getClerkKeys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/db/admin-overview", () => ({
  getAdminOverview: mocks.getAdminOverview,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const overview = { totalUsers: 3, signups: [] };

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.getAdminOverview.mockReset().mockResolvedValue(overview);
});

const load = () =>
  loader({
    request: new Request("https://sagashelf.app/admin/stats"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the statistics page of the administration (SAG-26)", () => {
  it("asks for an administrator before reading anything", async () => {
    mocks.requireRole.mockRejectedValue(new Response(null, { status: 403 }));

    await expect(load()).rejects.toBeInstanceOf(Response);
    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mocks.getAdminOverview).not.toHaveBeenCalled();
  });

  it("gives the overview and the keys for the session", async () => {
    const result = await load();

    expect(result).toMatchObject({
      publishableKey: "pk",
      overview,
      title: "app.pageTitle",
    });
    expect(mocks.getAdminOverview).toHaveBeenCalledWith(
      { fake: "database" },
      expect.any(Date),
    );
  });

  it("answers 503 when the accounts are not configured", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    await expect(load()).rejects.toMatchObject({ init: { status: 503 } });
  });

  it("is never kept by a shared cache and is not indexed", () => {
    expect(headers).toBeTypeOf("function");
    expect(meta({ loaderData: { title: "T" } } as never)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
  });
});
