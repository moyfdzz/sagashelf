import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSignedIn: vi.fn(),
  getHeaderState: vi.fn(),
}));

vi.mock("~server/auth/signed-in", () => ({ isSignedIn: mocks.isSignedIn }));
vi.mock("~server/auth/header-facts", () => ({
  getHeaderState: mocks.getHeaderState,
}));
vi.mock("~/middleware/clerk", () => ({ authMiddleware: vi.fn() }));
vi.mock("~/middleware/i18next", () => ({
  i18nextMiddleware: vi.fn(),
  getLocale: () => "es",
}));

import type { Route } from "./+types/root";
import { loader } from "./root";

beforeEach(() => {
  mocks.isSignedIn.mockReset().mockResolvedValue(true);
  mocks.getHeaderState
    .mockReset()
    .mockResolvedValue({ isAdmin: false, username: "ana_reads", unread: 0 });
});

const load = async () => {
  const result = await loader({
    request: new Request("https://sagashelf.app/"),
    params: {},
    context: {},
  } as unknown as Route.LoaderArgs);
  // `data()` wraps the object in a response of the router.
  return (result as unknown as { data: Record<string, unknown> }).data;
};

describe("the loader of the root: what the header needs (SAG-95, SAG-102, SAG-114)", () => {
  it("says an administrator is one, and only that", async () => {
    mocks.getHeaderState.mockResolvedValue({
      isAdmin: true,
      username: "ana_reads",
      unread: 0,
    });

    const root = await load();

    expect(root).toMatchObject({ signedIn: true, isAdmin: true });
    // A yes or no, the username for the link to the profile, the picture and a count: never the
    // role, the id or the email of the person.
    expect(Object.keys(root).sort()).toEqual([
      "avatarUrl",
      "isAdmin",
      "locale",
      "signedIn",
      "theme",
      "unread",
      "username",
    ]);
  });

  it("says a person who is not an administrator is not", async () => {
    expect(await load()).toMatchObject({ signedIn: true, isAdmin: false });
  });

  it("carries the username of a person with a session, for the link Perfil of the account menu", async () => {
    expect(await load()).toMatchObject({
      signedIn: true,
      username: "ana_reads",
    });
  });

  it("carries the number of unread notifications of a person with a session", async () => {
    mocks.getHeaderState.mockResolvedValue({
      isAdmin: false,
      username: "ana_reads",
      unread: 4,
    });

    expect(await load()).toMatchObject({ signedIn: true, unread: 4 });
  });

  it("makes ONE read for all three facts, not one for each", async () => {
    await load();

    expect(mocks.getHeaderState).toHaveBeenCalledTimes(1);
  });

  it("does not read anything for a visitor, and says nobody", async () => {
    mocks.isSignedIn.mockResolvedValue(false);
    mocks.getHeaderState.mockResolvedValue({
      isAdmin: true,
      username: "ana_reads",
      unread: 9,
    });

    const root = await load();

    expect(root).toMatchObject({
      signedIn: false,
      isAdmin: false,
      username: null,
      unread: 0,
    });
    expect(mocks.getHeaderState).not.toHaveBeenCalled();
  });
});
