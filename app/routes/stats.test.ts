import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/stats";
import { headers, loader } from "./stats";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getStats: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/stats", () => ({ getStats: mocks.getStats }));
vi.mock("~server/runtime-env", () => ({
  getDb: async () => ({ fake: "database" }),
}));
vi.mock("~/middleware/i18next", () => ({
  getInstance: () => ({ t: (key: string) => key }),
  getLocale: () => mocks.locale,
}));

const stats = { entries: 3 };

beforeEach(() => {
  mocks.locale = "es";
  mocks.requireUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.getStats.mockReset().mockResolvedValue(stats);
});

const load = () =>
  loader({
    request: new Request("https://sagashelf.app/stats"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);

describe("the statistics page loader", () => {
  it("reads the numbers of the person of the session, in the language of the page", async () => {
    mocks.locale = "en";

    const answer = await load();

    expect(mocks.getStats).toHaveBeenCalledWith(
      { fake: "database" },
      "user-1",
      "en",
    );
    expect(answer).toEqual({ title: "app.pageTitle", stats });
  });

  it("falls back to Spanish for any language that is not English", async () => {
    mocks.locale = "fr";

    await load();

    expect(mocks.getStats.mock.calls[0]?.[2]).toBe("es");
  });

  it("sends a visitor away and reads nothing", async () => {
    const redirect = new Response(null, {
      status: 303,
      headers: { Location: "/sign-in" },
    });
    mocks.requireUser.mockRejectedValue(redirect);

    await expect(load()).rejects.toBe(redirect);
    expect(mocks.getStats).not.toHaveBeenCalled();
  });

  it("is never kept by a shared cache", () => {
    expect(headers().get("Cache-Control")).toBe("private, no-store");
  });
});
