import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getClerkKeys: vi.fn(),
  getDb: vi.fn(),
  findRoleByClerkId: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("../runtime-env", () => ({
  getClerkKeys: mocks.getClerkKeys,
  getDb: mocks.getDb,
}));
vi.mock("../db/roles", () => ({ findRoleByClerkId: mocks.findRoleByClerkId }));

import { isAdministrator } from "./is-admin";

const args = {} as LoaderFunctionArgs;
const db = { fake: "database" };

beforeEach(() => {
  mocks.getAuth.mockReset().mockResolvedValue({ userId: "user_abc" });
  mocks.getClerkKeys.mockReset().mockReturnValue({});
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.findRoleByClerkId.mockReset().mockResolvedValue("admin");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("isAdministrator (SAG-95)", () => {
  it("is true for an account with the role admin, asked by the id of the session", async () => {
    expect(await isAdministrator(args)).toBe(true);
    expect(mocks.findRoleByClerkId).toHaveBeenCalledWith(db, "user_abc");
  });

  it("is false for a user and for a moderator", async () => {
    for (const role of ["user", "moderator"]) {
      mocks.findRoleByClerkId.mockResolvedValue(role);

      expect(await isAdministrator(args)).toBe(false);
    }
  });

  it("is false for a session whose account we do not hold", async () => {
    mocks.findRoleByClerkId.mockResolvedValue(null);

    expect(await isAdministrator(args)).toBe(false);
  });

  it("is false for a visitor, and does not wake the database", async () => {
    mocks.getAuth.mockResolvedValue({ userId: null });

    expect(await isAdministrator(args)).toBe(false);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.findRoleByClerkId).not.toHaveBeenCalled();
  });

  it("is false without Clerk keys, and does not ask for the session", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    expect(await isAdministrator(args)).toBe(false);
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("is false when the database fails, and says so by name without a value", async () => {
    mocks.findRoleByClerkId.mockRejectedValue(new TypeError("secret detail"));

    expect(await isAdministrator(args)).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "nav.admin_check_failed", error: "TypeError" }),
    );
  });

  it("is false when the database cannot even be reached", async () => {
    mocks.getDb.mockRejectedValue(new Error("DATABASE_URL is not set"));

    expect(await isAdministrator(args)).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ event: "nav.admin_check_failed", error: "Error" }),
    );
  });
});
