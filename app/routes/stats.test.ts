import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/stats";
import { headers, loader } from "./stats";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getStats: vi.fn(),
  locale: "es",
}));

vi.mock("~server/auth/require", () => ({ requireUser: mocks.requireUser }));
vi.mock("~server/db/stats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~server/db/stats")>()),
  getStats: mocks.getStats,
}));
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

const load = (search = "") =>
  loader({
    request: new Request(`https://sagashelf.app/stats${search}`),
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
      undefined,
    );
    expect(answer).toEqual({ title: "app.pageTitle", type: null, stats });
  });

  it("narrows the numbers to the type of the tab (SAG-91)", async () => {
    for (const type of ["movie", "series", "anime", "book", "manga"]) {
      mocks.getStats.mockClear();

      const answer = await load(`?type=${type}`);

      expect(mocks.getStats.mock.calls[0]?.[3]).toBe(type);
      expect(answer).toMatchObject({ type });
    }
  });

  it("counts every type for a type that does not exist, for an empty one and for 'custom'", async () => {
    for (const search of [
      "?type=nope",
      "?type=",
      "?type=custom",
      "?type=MANGA",
    ]) {
      mocks.getStats.mockClear();

      const answer = await load(search);

      expect(mocks.getStats.mock.calls[0]?.[3]).toBeUndefined();
      expect(answer).toMatchObject({ type: null });
    }
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
