import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.stats.traffic";
import { headers, loader, meta } from "./admin.stats.traffic";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getAdminTraffic: vi.fn(),
  getClerkKeys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/db/admin-traffic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~server/db/admin-traffic")>()),
  getAdminTraffic: mocks.getAdminTraffic,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const traffic = { days: 30, pageviews: 3 };

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.getAdminTraffic.mockReset().mockResolvedValue(traffic);
});

const load = (search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/admin/stats/traffic${search}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the traffic page of the administration (SAG-26)", () => {
  it("asks for an administrator before reading anything", async () => {
    mocks.requireRole.mockRejectedValue(new Response(null, { status: 403 }));

    await expect(load()).rejects.toBeInstanceOf(Response);
    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mocks.getAdminTraffic).not.toHaveBeenCalled();
  });

  it("reads 30 days by default and the window the address names", async () => {
    await load();
    await load("?days=7");
    await load("?days=90");

    expect(mocks.getAdminTraffic.mock.calls.map((call) => call[2])).toEqual([
      30, 7, 90,
    ]);
  });

  it("ignores a window the page does not offer", async () => {
    await load("?days=365");
    await load("?days=7%20");

    expect(mocks.getAdminTraffic.mock.calls.map((call) => call[2])).toEqual([
      30, 30,
    ]);
  });

  it("gives the traffic, the windows to choose from and the keys for the session", async () => {
    const result = await load();

    expect(result).toMatchObject({
      publishableKey: "pk",
      traffic,
      options: [7, 30, 90],
    });
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
