import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/admin.stats.content";
import { headers, loader, meta } from "./admin.stats.content";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getAdminContent: vi.fn(),
  getClerkKeys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  rootAuthLoader: async (_args: unknown, callback: () => unknown) => callback(),
}));
vi.mock("~server/auth/require", () => ({ requireRole: mocks.requireRole }));
vi.mock("~server/db/admin-content", () => ({
  getAdminContent: mocks.getAdminContent,
}));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
  getClerkKeys: mocks.getClerkKeys,
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
}));

const content = { days: 30, customTotal: 3 };

beforeEach(() => {
  mocks.requireRole.mockReset().mockResolvedValue({ id: "admin-1" });
  mocks.getClerkKeys
    .mockReset()
    .mockReturnValue({ publishableKey: "pk", secretKey: "sk" });
  mocks.getAdminContent.mockReset().mockResolvedValue(content);
});

const load = (search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/admin/stats/content${search}`),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the content page of the administration (SAG-26)", () => {
  it("asks for an administrator before reading anything", async () => {
    mocks.requireRole.mockRejectedValue(new Response(null, { status: 403 }));

    await expect(load()).rejects.toBeInstanceOf(Response);
    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mocks.getAdminContent).not.toHaveBeenCalled();
  });

  it("reads 30 days by default, the window the address names, and ignores any other", async () => {
    await load();
    await load("?days=7");
    await load("?days=90");
    await load("?days=365");
    await load("?days=7%20");

    expect(mocks.getAdminContent.mock.calls.map((call) => call[2])).toEqual([
      30, 7, 90, 30, 30,
    ]);
  });

  it("gives the content, the windows and the keys for the session", async () => {
    expect(await load()).toMatchObject({
      publishableKey: "pk",
      content,
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
