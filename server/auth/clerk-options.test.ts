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
  it("returns null when Clerk is not configured", () => {
    expect(clerkKeysFromEnv({})).toBeNull();
    expect(clerkKeysFromEnv({ CLERK_PUBLISHABLE_KEY: "pk_test_x" })).toBeNull();
  });

  it("treats empty values as not set, and ignores unrelated variables", () => {
    expect(
      clerkKeysFromEnv({
        CLERK_PUBLISHABLE_KEY: "",
        CLERK_SECRET_KEY: "",
        CLERK_JWT_KEY: "",
        APP_ENV: "",
        DATABASE_URL: "",
      }),
    ).toBeNull();
  });

  it("returns the keys, with the JWT key normalized", () => {
    expect(
      clerkKeysFromEnv({
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

  it("names a malformed key without echoing it", () => {
    const bad = "sk_wrong_value";
    let message = "";
    try {
      clerkKeysFromEnv({
        CLERK_PUBLISHABLE_KEY: "pk_test_x",
        CLERK_SECRET_KEY: bad,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("CLERK_SECRET_KEY");
    expect(message).not.toContain(bad);
  });
});
