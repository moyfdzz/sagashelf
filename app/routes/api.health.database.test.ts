import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./api.health.database";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("~server/runtime-env", () => ({ getDb: mocks.getDb }));

const call = () => new Request("http://localhost/api/health/database");

beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue({ rows: [{ "?column?": 1 }] });
  mocks.getDb.mockReset().mockResolvedValue({ execute: mocks.execute });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/health/database", () => {
  it("answers 200 with a status and no extra data when the database answers", async () => {
    const response = await loader({ request: call() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("answers 503 with no detail when the statement fails", async () => {
    mocks.execute.mockRejectedValue(
      new Error("connection to db.example.test refused"),
    );

    const response = await loader({ request: call() });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: "unavailable" });
    expect(text).not.toContain("example.test");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 503 when the database cannot be opened, such as a missing secret", async () => {
    mocks.getDb.mockRejectedValue(new Error("DATABASE_URL is not set"));

    const response = await loader({ request: call() });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("DATABASE_URL");
  });

  it("answers 503 when the database does not answer in time", async () => {
    vi.useFakeTimers();
    mocks.execute.mockReturnValue(new Promise(() => undefined));

    const pending = loader({ request: call() });
    await vi.advanceTimersByTimeAsync(8_000);
    const response = await pending;

    expect(response.status).toBe(503);
  });
});
