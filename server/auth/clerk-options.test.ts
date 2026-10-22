import { describe, expect, it } from "vitest";

import { clerkKeysFromEnv, normalizeJwtKey } from "./clerk-options";

describe("normalizeJwtKey", () => {
  it("turns escaped line breaks into real ones", () => {
    expect(normalizeJwtKey("-----BEGIN-----\nabc\n-----END-----")).toBe(
      "-----BEGIN-----\nabc\n-----END-----",
    );
  });

  it("leaves a key that already has line breaks alone", () => {
    expect(normalizeJwtKey("a\nb\n")).toBe("a\nb");
  });
});

describe("clerkKeysFromEnv", () => {
  const base = { APP_ENV: "development" as const };

  it("returns null when Clerk is not configured", () => {
    expect(clerkKeysFromEnv(base)).toBeNull();
    expect(
      clerkKeysFromEnv({ ...base, CLERK_PUBLISHABLE_KEY: "pk_test_x" }),
    ).toBeNull();
  });

  it("returns the keys, with the JWT key normalized", () => {
    expect(
      clerkKeysFromEnv({
        ...base,
        CLERK_PUBLISHABLE_KEY: "pk_test_x",
        CLERK_SECRET_KEY: "sk_test_x",
        CLERK_JWT_KEY: "a\nb",
      }),
    ).toEqual({
      publishableKey: "pk_test_x",
      secretKey: "sk_test_x",
      jwtKey: "a\nb",
    });
  });
});
