import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("returns typed values when the environment is valid", () => {
    expect(parseEnv({ APP_ENV: "production" })).toEqual({
      APP_ENV: "production",
    });
  });

  it("accepts an optional value and rejects an empty one", () => {
    expect(parseEnv({ APP_ENV: "preview", CLERK_JWT_KEY: "set" })).toEqual({
      APP_ENV: "preview",
      CLERK_JWT_KEY: "set",
    });
    expect(() => parseEnv({ APP_ENV: "preview", CLERK_JWT_KEY: "" })).toThrow(
      /CLERK_JWT_KEY/,
    );
  });

  it("ignores a variable it does not know, so a leftover secret breaks nothing", () => {
    expect(parseEnv({ APP_ENV: "preview", OLD_SECRET: "set" })).toEqual({
      APP_ENV: "preview",
    });
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

  it("accepts MANGADEX_ENABLED as true or false and nothing else", () => {
    expect(parseEnv({ APP_ENV: "preview", MANGADEX_ENABLED: "false" })).toEqual(
      {
        APP_ENV: "preview",
        MANGADEX_ENABLED: "false",
      },
    );
    expect(() =>
      parseEnv({ APP_ENV: "preview", MANGADEX_ENABLED: "1" }),
    ).toThrow(/MANGADEX_ENABLED/);
  });

  it("accepts WIKIDATA_ENABLED as true or false and nothing else", () => {
    expect(parseEnv({ APP_ENV: "preview", WIKIDATA_ENABLED: "true" })).toEqual({
      APP_ENV: "preview",
      WIKIDATA_ENABLED: "true",
    });
    expect(() =>
      parseEnv({ APP_ENV: "preview", WIKIDATA_ENABLED: "yes" }),
    ).toThrow(/WIKIDATA_ENABLED/);
  });

  it("accepts OPEN_LIBRARY_ENABLED as true or false and nothing else", () => {
    expect(
      parseEnv({ APP_ENV: "preview", OPEN_LIBRARY_ENABLED: "true" }),
    ).toEqual({ APP_ENV: "preview", OPEN_LIBRARY_ENABLED: "true" });
    expect(() =>
      parseEnv({ APP_ENV: "preview", OPEN_LIBRARY_ENABLED: "yes" }),
    ).toThrow(/OPEN_LIBRARY_ENABLED/);
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
