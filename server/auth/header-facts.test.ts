import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getClerkKeys: vi.fn(),
  getDb: vi.fn(),
  findHeaderFacts: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({ getAuth: mocks.getAuth }));
vi.mock("../runtime-env", () => ({
  getClerkKeys: mocks.getClerkKeys,
  getDb: mocks.getDb,
}));
vi.mock("../db/header-facts", () => ({
  findHeaderFacts: mocks.findHeaderFacts,
}));

import { getHeaderState } from "./header-facts";

const args = {} as LoaderFunctionArgs;
const db = { fake: "database" };
const nobody = { isAdmin: false, username: null, avatarUrl: null, unread: 0 };

beforeEach(() => {
  mocks.getAuth.mockReset().mockResolvedValue({ userId: "user_abc" });
  mocks.getClerkKeys.mockReset().mockReturnValue({});
  mocks.getDb.mockReset().mockResolvedValue(db);
  mocks.findHeaderFacts
    .mockReset()
    .mockResolvedValue({ isAdmin: true, username: "ana_reads", unread: 7 });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("getHeaderState (SAG-114)", () => {
  it("reads the three facts, asked by the id of the session and nobody else", async () => {
    expect(await getHeaderState(args)).toEqual({
      isAdmin: true,
      username: "ana_reads",
      unread: 7,
    });
    expect(mocks.findHeaderFacts).toHaveBeenCalledTimes(1);
    expect(mocks.findHeaderFacts).toHaveBeenCalledWith(db, "user_abc");
  });

  it("says nobody for a visitor, without opening the database", async () => {
    mocks.getAuth.mockResolvedValue({ userId: null });

    expect(await getHeaderState(args)).toEqual(nobody);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("says nobody without Clerk keys, where nobody is signed in", async () => {
    mocks.getClerkKeys.mockReturnValue(null);

    expect(await getHeaderState(args)).toEqual(nobody);
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });

  it("says nobody for an account that does not exist or was erased", async () => {
    mocks.findHeaderFacts.mockResolvedValue(null);

    expect(await getHeaderState(args)).toEqual(nobody);
  });

  it("says nobody when the database fails, and logs the name of the error and nothing else", async () => {
    mocks.findHeaderFacts.mockRejectedValue(
      new TypeError("connection to secret-host failed"),
    );

    expect(await getHeaderState(args)).toEqual(nobody);
    const logged = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(logged).toContain("nav.header_facts_failed");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-host");
  });
});
