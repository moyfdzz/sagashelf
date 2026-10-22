import { describe, expect, it } from "vitest";

import {
  clerkKeysFromEnv,
  normalizeJwtKey,
  webhookSecretFromEnv,
} from "./clerk-options";

describe("webhookSecretFromEnv", () => {
  it("is null when the secret is missing or empty", () => {
    expect(webhookSecretFromEnv({})).toBeNull();
    expect(
      webhookSecretFromEnv({ CLERK_WEBHOOK_SIGNING_SECRET: "" }),
    ).toBeNull();
  });

  it("returns a secret in the whsec_ shape", () => {
    expect(
      webhookSecretFromEnv({ CLERK_WEBHOOK_SIGNING_SECRET: "whsec_abc" }),
    ).toBe("whsec_abc");
  });

  it("names a malformed secret without echoing it", () => {
    const bad = "not-a-secret-value";
    let message = "";
    try {
      webhookSecretFromEnv({ CLERK_WEBHOOK_SIGNING_SECRET: bad });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("CLERK_WEBHOOK_SIGNING_SECRET");
    expect(message).not.toContain(bad);
  });
});

describe("normalizeJwtKey", () => {
  it("turns escaped line breaks into real ones", () => {
    expect(normalizeJwtKey("-----BEGIN-----\\nabc\\n-----END-----")).toBe(
      "-----BEGIN-----\nabc\n-----END-----",
    );
  });

  it("drops quotes that a dashboard value kept around the key", () => {
    expect(normalizeJwtKey('"-----BEGIN-----\\nabc\\n-----END-----"')).toBe(
      "-----BEGIN-----\nabc\n-----END-----",
    );
    expect(normalizeJwtKey("'a\\nb'")).toBe("a\nb");
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
        CLERK_JWT_KEY: "a\\nb",
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
