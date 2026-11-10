import { beforeEach, describe, expect, it, vi } from "vitest";

import { refundOpenUnits, spendOpenUnit, trySpendOpenUnit } from "./open-limit";

const mocks = vi.hoisted(() => ({
  limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(),
  claim: vi.fn<() => Promise<"ok" | "limit" | "gone">>(),
  refund: vi.fn<(db: unknown, id: string, units: number) => Promise<void>>(),
}));

vi.mock("./runtime-env", () => ({
  getOpenLimiter: () => ({ limit: mocks.limit }),
}));
vi.mock("./db/title-budget", () => ({
  claimTitleFetch: mocks.claim,
  refundTitleFetches: mocks.refund,
}));

const db = { execute: vi.fn() };
const request = new Request("https://example.test/media/open", {
  headers: { "CF-Connecting-IP": "203.0.113.7" },
});

beforeEach(() => {
  mocks.limit.mockReset().mockResolvedValue({ success: true });
  mocks.claim.mockReset().mockResolvedValue("ok");
  mocks.refund.mockReset().mockResolvedValue(undefined);
});

describe("spendOpenUnit", () => {
  it("lets the call go on when both limits allow it", async () => {
    expect(await spendOpenUnit(request, db, "user-1")).toBeNull();
    expect(mocks.limit).toHaveBeenCalledWith({
      key: "media-open:user-1:203.0.113.7",
    });
    expect(mocks.claim).toHaveBeenCalledWith(db, "user-1");
  });

  it("stops a burst before the database is asked", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    const refused = await spendOpenUnit(request, db, "user-1");

    expect(refused?.status).toBe(429);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("refuses with the time to the next UTC day when the daily budget is spent", async () => {
    mocks.claim.mockResolvedValue("limit");

    const refused = await spendOpenUnit(request, db, "user-1");

    expect(refused?.status).toBe(429);
    expect(await refused?.json()).toEqual({ error: "rate_limited" });
    const wait = Number(refused?.headers.get("Retry-After"));
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(86_400);
  });

  it("answers 403 when the account is gone", async () => {
    mocks.claim.mockResolvedValue("gone");

    expect((await spendOpenUnit(request, db, "user-1"))?.status).toBe(403);
  });
});

describe("trySpendOpenUnit", () => {
  it("says which limit refused: the burst, the day, or a gone account", async () => {
    expect((await trySpendOpenUnit(request, db, "user-1")).status).toBe("ok");

    mocks.claim.mockResolvedValue("limit");
    expect((await trySpendOpenUnit(request, db, "user-1")).status).toBe(
      "daily",
    );

    mocks.claim.mockResolvedValue("gone");
    expect((await trySpendOpenUnit(request, db, "user-1")).status).toBe("gone");

    mocks.limit.mockResolvedValue({ success: false });
    expect((await trySpendOpenUnit(request, db, "user-1")).status).toBe(
      "burst",
    );
  });
});

describe("refundOpenUnits", () => {
  it("gives the units back through the counter of the person", async () => {
    await refundOpenUnits(db, "user-1", 2);

    expect(mocks.refund).toHaveBeenCalledWith(db, "user-1", 2);
  });
});
