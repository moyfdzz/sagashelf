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
