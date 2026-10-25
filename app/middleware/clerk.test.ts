import { beforeEach, describe, expect, it, vi } from "vitest";

import { authMiddleware } from "./clerk";

const mocks = vi.hoisted(() => ({
  clerkMiddleware: vi.fn(),
  inner: vi.fn(),
  keys: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  clerkMiddleware: mocks.clerkMiddleware,
}));
vi.mock("~server/runtime-env", () => ({ getClerkKeys: mocks.keys }));

const clerkKeys = {
  publishableKey: "publishable-key-for-tests",
  secretKey: "secret-for-tests",
  jwtKey: "jwt-key-for-tests",
};

beforeEach(() => {
  mocks.inner.mockReset().mockResolvedValue(new Response("ok"));
  mocks.clerkMiddleware.mockReset().mockReturnValue(mocks.inner);
  mocks.keys.mockReset().mockReturnValue(clerkKeys);
});

const run = (url: string) => {
  const next = vi.fn().mockResolvedValue(new Response("page"));
  const args = { request: new Request(url), context: {}, params: {} };
  return {
    next,
    result: authMiddleware(
      args as unknown as Parameters<typeof authMiddleware>[0],
      next,
    ),
  };
};

describe("the auth middleware", () => {
  it("accepts a session token only for the site that was asked", async () => {
    await run("https://sagashelf.app/library").result;

    expect(mocks.clerkMiddleware).toHaveBeenCalledWith({
      ...clerkKeys,
      authorizedParties: ["https://sagashelf.app"],
    });
  });

  it("takes the site from each request, so a preview accepts its own tokens", async () => {
    await run("https://feat-x-sagashelf.example.workers.dev/search").result;

    expect(mocks.clerkMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedParties: ["https://feat-x-sagashelf.example.workers.dev"],
      }),
    );
  });

  it("does not look at the session of a webhook, which carries a signature", async () => {
    const { result, next } = run("https://sagashelf.app/webhooks/clerk");
    await result;

    expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("lets the request go on signed out when the deployment has no Clerk keys", async () => {
    mocks.keys.mockReturnValue(null);

    const { result, next } = run("https://sagashelf.app/");
    await result;

    expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
