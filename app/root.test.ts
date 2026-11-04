import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSignedIn: vi.fn(),
  isAdministrator: vi.fn(),
  unreadNotifications: vi.fn(),
}));

vi.mock("~server/auth/signed-in", () => ({ isSignedIn: mocks.isSignedIn }));
vi.mock("~server/auth/is-admin", () => ({
  isAdministrator: mocks.isAdministrator,
}));
vi.mock("~server/auth/unread-notifications", () => ({
  unreadNotifications: mocks.unreadNotifications,
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
  mocks.isAdministrator.mockReset().mockResolvedValue(false);
  mocks.unreadNotifications.mockReset().mockResolvedValue(0);
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

describe("the loader of the root: what the header needs (SAG-95)", () => {
  it("says an administrator is one, and only that", async () => {
    mocks.isAdministrator.mockResolvedValue(true);

    const root = await load();

    expect(root).toMatchObject({ signedIn: true, isAdmin: true });
    // Two yes-or-no answers and a count: never the role, the id or the email of the person.
    expect(Object.keys(root).sort()).toEqual([
      "isAdmin",
      "locale",
      "signedIn",
      "theme",
      "unread",
    ]);
  });

  it("says a person who is not an administrator is not", async () => {
    expect(await load()).toMatchObject({ signedIn: true, isAdmin: false });
  });

  it("does not look at the role of a visitor, which would be a read for nothing", async () => {
    mocks.isSignedIn.mockResolvedValue(false);
    mocks.isAdministrator.mockResolvedValue(true);

    const root = await load();

    expect(root).toMatchObject({ signedIn: false, isAdmin: false });
    expect(mocks.isAdministrator).not.toHaveBeenCalled();
  });

  it("carries the number of unread notifications of a person with a session (SAG-102)", async () => {
    mocks.unreadNotifications.mockResolvedValue(4);

    expect(await load()).toMatchObject({ signedIn: true, unread: 4 });
  });

  it("does not count the notifications of a visitor", async () => {
    mocks.isSignedIn.mockResolvedValue(false);
    mocks.unreadNotifications.mockResolvedValue(9);

    expect(await load()).toMatchObject({ signedIn: false, unread: 0 });
    expect(mocks.unreadNotifications).not.toHaveBeenCalled();
  });
});
