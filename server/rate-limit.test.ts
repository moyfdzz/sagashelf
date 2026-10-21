import { describe, expect, it } from "vitest";

import { rateLimit, type RateLimiter } from "./rate-limit";

function limiterThatAllows(allowed: boolean) {
  const keys: string[] = [];
  const limiter: RateLimiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: allowed };
    },
  };
  return { limiter, keys };
}

describe("rateLimit", () => {
  it("lets the request go on when the caller is under the limit", async () => {
    const { limiter } = limiterThatAllows(true);

    expect(await rateLimit(limiter, new Request("http://x/"), "s")).toBeNull();
  });

  it("answers 429 with Retry-After when the caller is over the limit", async () => {
    const { limiter } = limiterThatAllows(false);

    const response = await rateLimit(limiter, new Request("http://x/"), "s");

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    expect(await response?.json()).toEqual({ error: "rate_limited" });
  });

  it("counts each caller and scope separately", async () => {
    const { limiter, keys } = limiterThatAllows(true);

    await rateLimit(
      limiter,
      new Request("http://x/", { headers: { "CF-Connecting-IP": "1.2.3.4" } }),
      "locale",
    );
    await rateLimit(limiter, new Request("http://x/"), "search");

    expect(keys).toEqual(["locale:1.2.3.4", "search:unknown"]);
  });
});
