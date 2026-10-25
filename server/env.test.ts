import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("returns typed values when the environment is valid", () => {
    expect(parseEnv({ APP_ENV: "production" })).toEqual({
      APP_ENV: "production",
    });
  });

  it("accepts the optional Turnstile secret and rejects an empty one", () => {
    expect(
      parseEnv({ APP_ENV: "preview", TURNSTILE_SECRET_KEY: "set" }),
    ).toEqual({ APP_ENV: "preview", TURNSTILE_SECRET_KEY: "set" });
    expect(() =>
      parseEnv({ APP_ENV: "preview", TURNSTILE_SECRET_KEY: "" }),
    ).toThrow(/TURNSTILE_SECRET_KEY/);
  });

  it("validates the Clerk keys by prefix without echoing them", () => {
    expect(
      parseEnv({
        APP_ENV: "development",
        CLERK_PUBLISHABLE_KEY: "pk_test_abc",
        CLERK_SECRET_KEY: "sk_test_abc",
        CLERK_JWT_KEY: "pem",
      }),
    ).toMatchObject({ CLERK_PUBLISHABLE_KEY: "pk_test_abc" });

    const bad = "sk_wrong_value";
    let message = "";
    try {
      parseEnv({ APP_ENV: "development", CLERK_SECRET_KEY: bad });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("CLERK_SECRET_KEY");
    expect(message).not.toContain(bad);
  });

  it("accepts the optional TMDB token and rejects an empty one", () => {
    expect(
      parseEnv({ APP_ENV: "preview", TMDB_READ_ACCESS_TOKEN: "set" }),
    ).toEqual({ APP_ENV: "preview", TMDB_READ_ACCESS_TOKEN: "set" });
    expect(() =>
      parseEnv({ APP_ENV: "preview", TMDB_READ_ACCESS_TOKEN: "" }),
    ).toThrow(/TMDB_READ_ACCESS_TOKEN/);
  });

  it("names a missing variable", () => {
    expect(() => parseEnv({})).toThrow(/APP_ENV/);
  });

  it("names an invalid variable without leaking its value", () => {
    const leaked = "super-secret-value";
    let message = "";
    try {
      parseEnv({ APP_ENV: leaked });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("APP_ENV");
    expect(message).not.toContain(leaked);
  });
});
