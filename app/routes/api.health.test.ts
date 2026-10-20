import { describe, expect, it } from "vitest";

import { loader } from "./api.health";

describe("GET /api/health", () => {
  it("returns 200 with a status and no extra data", async () => {
    const response = loader();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
