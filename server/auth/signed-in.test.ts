import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuth = vi.fn();
const getClerkKeys = vi.fn();

vi.mock("@clerk/react-router/server", () => ({
  getAuth: (...args: unknown[]) => getAuth(...args),
}));
vi.mock("../runtime-env", () => ({
  getClerkKeys: () => getClerkKeys(),
}));

import { isSignedIn } from "./signed-in";

const args = {} as LoaderFunctionArgs;

describe("isSignedIn", () => {
  beforeEach(() => {
    getAuth.mockReset();
    getClerkKeys.mockReset();
  });

  it("is false without Clerk keys, and does not ask for the session", async () => {
    getClerkKeys.mockReturnValue(null);

    expect(await isSignedIn(args)).toBe(false);
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("is true when the verified session has a user", async () => {
    getClerkKeys.mockReturnValue({});
    getAuth.mockResolvedValue({ userId: "user_abc" });

    expect(await isSignedIn(args)).toBe(true);
  });

  it("is false for a visitor", async () => {
    getClerkKeys.mockReturnValue({});
    getAuth.mockResolvedValue({ userId: null });

    expect(await isSignedIn(args)).toBe(false);
  });
});
