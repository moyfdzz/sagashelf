import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getClerkKeys: vi.fn(),
  getDb: vi.fn(),
  countUnreadByClerkId: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("../runtime-env", () => ({
  getClerkKeys: mocks.getClerkKeys,
  getDb: mocks.getDb,
}));
vi.mock("../db/notifications", () => ({
  countUnreadByClerkId: mocks.countUnreadByClerkId,
}));

import { unreadNotifications } from "./unread-notifications";

const args = {} as LoaderFunctionArgs;
const db = { fake: "database" };

beforeEach(() => {
  mocks.getAuth.mockReset().mockResolvedValue({ userId: "user_abc" });
  mocks.getClerkKeys.mockReset().mockReturnValue({});
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.countUnreadByClerkId.mockReset().mockResolvedValue(7);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("unreadNotifications (SAG-102)", () => {
  it("counts for the id of the session", async () => {
    expect(await unreadNotifications(args)).toBe(7);
    expect(mocks.countUnreadByClerkId).toHaveBeenCalledWith(db, "user_abc");
  });

  it("is 0 for a visitor, without opening the database", async () => {
    mocks.getAuth.mockResolvedValue({ userId: null });

    expect(await unreadNotifications(args)).toBe(0);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("is 0 without Clerk keys, where nobody is signed in", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    expect(await unreadNotifications(args)).toBe(0);
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });

  it("is 0 when the database fails, and logs the name of the error and nothing else", async () => {
    mocks.countUnreadByClerkId.mockRejectedValue(
      new TypeError("connection to secret-host failed"),
    );

    expect(await unreadNotifications(args)).toBe(0);
    const logged = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(logged).toContain("nav.unread_check_failed");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-host");
  });
});
