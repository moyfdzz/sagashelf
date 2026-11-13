import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordProviderCall, takeProviderCalls } from "./call-log";
import { flushProviderCalls } from "./flush";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  saveProviderCalls: vi.fn(),
  clearDatabaseUsed: vi.fn(),
}));

vi.mock("../runtime-env", () => ({
  getDb: mocks.getDb,
  clearDatabaseUsed: mocks.clearDatabaseUsed,
}));
vi.mock("../db/provider-calls", () => ({
  saveProviderCalls: mocks.saveProviderCalls,
}));

beforeEach(() => {
  takeProviderCalls();
  mocks.getDb.mockReset().mockResolvedValue({ fake: "database" });
  mocks.saveProviderCalls.mockReset().mockResolvedValue(undefined);
  mocks.clearDatabaseUsed.mockReset();
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

  it("never throws, logs only the name of the error, and keeps what it could not write for the next flush", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.saveProviderCalls.mockRejectedValue(
      new Error("the message holds a private detail"),
    );
    count();

    await expect(flushProviderCalls()).resolves.toBeUndefined();

    const written = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(written)).toEqual({
      event: "provider_calls.flush_failed",
      error: "Error",
    });
    expect(written).not.toContain("private detail");
    // The counts went back to the memory: the next flush writes them, with what came after.
    mocks.saveProviderCalls.mockResolvedValue(undefined);
    count();
    await flushProviderCalls();
    expect(mocks.saveProviderCalls).toHaveBeenCalledTimes(2);
    expect(mocks.saveProviderCalls.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({ provider: "tmdb", calls: 2, requests: 2 }),
    ]);
    log.mockRestore();
  });

  it("forgets that the database was used only after the write, so the write itself does not count as a use", async () => {
    const order: string[] = [];
    mocks.saveProviderCalls.mockImplementation(async () => {
      order.push("write");
    });
    mocks.clearDatabaseUsed.mockImplementation(() => {
      order.push("clear");
    });
    count();

    await flushProviderCalls();

    expect(order).toEqual(["write", "clear"]);
  });

  it("forgets it too when there is nothing to write, and when the write fails", async () => {
    await flushProviderCalls();
    expect(mocks.clearDatabaseUsed).toHaveBeenCalledTimes(1);

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.saveProviderCalls.mockRejectedValue(new Error("down"));
    count();
    await flushProviderCalls();
    expect(mocks.clearDatabaseUsed).toHaveBeenCalledTimes(2);
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
