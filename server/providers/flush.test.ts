import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordProviderCall, takeProviderCalls } from "./call-log";
import { flushProviderCalls } from "./flush";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  saveProviderCalls: vi.fn(),
}));

vi.mock("../runtime-env", () => ({ getDb: mocks.getDb }));
vi.mock("../db/provider-calls", () => ({
  saveProviderCalls: mocks.saveProviderCalls,
}));

beforeEach(() => {
  takeProviderCalls();
  mocks.getDb.mockReset().mockResolvedValue({ fake: "database" });
  mocks.saveProviderCalls.mockReset().mockResolvedValue(undefined);
});

const count = () =>
  recordProviderCall(
    { provider: "tmdb", outcome: "ok", requests: 1, ms: 40 },
    new Date("2026-11-12T12:00:00Z"),
  );

describe("flushProviderCalls (SAG-26)", () => {
  it("does not even open the database when nothing was counted", async () => {
    await flushProviderCalls();

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.saveProviderCalls).not.toHaveBeenCalled();
  });

  it("writes what was counted in one call and starts from zero", async () => {
    count();
    count();

    await flushProviderCalls();

    expect(mocks.saveProviderCalls).toHaveBeenCalledTimes(1);
    expect(mocks.saveProviderCalls).toHaveBeenCalledWith({ fake: "database" }, [
      {
        day: "2026-11-12",
        provider: "tmdb",
        outcome: "ok",
        calls: 2,
        requests: 2,
        latencyMs: 80,
      },
    ]);
    await flushProviderCalls();
    expect(mocks.saveProviderCalls).toHaveBeenCalledTimes(1);
  });

  it("never throws, logs only the name of the error, and drops what it could not write", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.saveProviderCalls.mockRejectedValue(
      new Error("connection string postgres://secret"),
    );
    count();

    await expect(flushProviderCalls()).resolves.toBeUndefined();

    const written = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(written)).toEqual({
      event: "provider_calls.flush_failed",
      error: "Error",
    });
    expect(written).not.toContain("secret");
    // The counts of that moment are gone, so the memory does not grow while the database is down.
    await flushProviderCalls();
    expect(mocks.saveProviderCalls).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("does not throw when the database cannot even be opened", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.getDb.mockRejectedValue(new TypeError("DATABASE_URL is not set"));
    count();

    await expect(flushProviderCalls()).resolves.toBeUndefined();

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      error: "TypeError",
    });
    log.mockRestore();
  });
});
