import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("returns typed values when the environment is valid", () => {
    expect(parseEnv({ APP_ENV: "production" })).toEqual({
      APP_ENV: "production",
    });
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
