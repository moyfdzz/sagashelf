import { describe, expect, it } from "vitest";

import { buildProviders } from "./registry";

describe("buildProviders", () => {
  it("has no provider without a secret", () => {
    expect(buildProviders({})).toEqual([]);
    expect(buildProviders({ tmdbReadAccessToken: "" })).toEqual([]);
  });

  it("has TMDB when its token is set, and reuses it so its limits persist", () => {
    const first = buildProviders({ tmdbReadAccessToken: "demo-token" });
    const second = buildProviders({ tmdbReadAccessToken: "demo-token" });

    expect(first.map((provider) => provider.id)).toEqual(["tmdb"]);
    expect(second[0]).toBe(first[0]);
  });
});
