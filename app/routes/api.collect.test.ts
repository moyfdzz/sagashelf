import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "./+types/api.collect";
import { action, loader } from "./api.collect";
import type { CollectEvent } from "~server/analytics/event";

// The real bindings only exist inside the Worker runtime.
const mocks = vi.hoisted(() => ({
  enabled: vi.fn<() => boolean>(() => true),
  limiter: {
    limit: vi.fn<(options: { key: string }) => Promise<{ success: boolean }>>(
      async () => ({ success: true }),
    ),
  },
  recordEvent: vi.fn<
    (
      db: unknown,
      request: Request,
      event: CollectEvent,
      now: Date,
    ) => Promise<void>
  >(async () => undefined),
}));
vi.mock("~server/runtime-env", () => ({
  getAnalyticsEnabled: () => mocks.enabled(),
  getCollectLimiter: () => mocks.limiter,
  getDb: async () => ({}),
}));
vi.mock("~server/analytics/record", () => ({ recordEvent: mocks.recordEvent }));

const browser =
  "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

beforeEach(() => {
  mocks.enabled.mockReset().mockReturnValue(true);
  mocks.limiter.limit.mockClear();
  mocks.limiter.limit.mockResolvedValue({ success: true });
  mocks.recordEvent.mockClear();
});

function send(
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
): Promise<Response> {
  const request = new Request("http://localhost/api/collect", {
    method,
    headers: {
      Origin: "http://localhost",
      "User-Agent": browser,
      "CF-Connecting-IP": "203.0.113.7",
      ...headers,
    },
    body,
  });
  return action({ request } as Route.ActionArgs) as Promise<Response>;
}

const pageview = JSON.stringify({ kind: "pageview", path: "/sagas" });

describe("POST /api/collect", () => {
  it("stores an event and answers with nothing", async () => {
    const response = await send(pageview);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordEvent.mock.calls[0]?.[2]).toEqual({
      kind: "pageview",
      path: "/sagas",
    });
  });

  it("stores the speed of a page load, with the numbers that were measured (SAG-254)", async () => {
    const body = JSON.stringify({
      kind: "vitals",
      path: "/",
      lcp: 1800.5,
      cls: 0,
    });

    const response = await send(body);

    expect(response.status).toBe(204);
    expect(mocks.recordEvent.mock.calls[0]?.[2]).toEqual({
      kind: "vitals",
      path: "/",
      lcp: 1800.5,
      cls: 0,
    });
  });

  it.each([
    ["no number", { kind: "vitals", path: "/" }],
    ["a time over a minute", { kind: "vitals", path: "/", lcp: 120_000 }],
    ["a negative layout shift", { kind: "vitals", path: "/", cls: -1 }],
  ])("answers 400 for a speed event with %s", async (_name, event) => {
    const response = await send(JSON.stringify(event));

    expect(response.status).toBe(400);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("takes the body of a beacon, whatever its content type says", async () => {
    const response = await send(pageview, {
      "Content-Type": "text/plain;charset=UTF-8",
    });
    expect(response.status).toBe(204);
    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
  });

  it("refuses a page of another site before anything else", async () => {
    const response = await send(pageview, { Origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(mocks.limiter.limit).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("refuses a body that says it is too big without reading it", async () => {
    const response = await send(pageview, { "Content-Length": "100000" });
    expect(response.status).toBe(413);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("stops a body that is too big even when it hides its size", async () => {
    const big = JSON.stringify({
      kind: "pageview",
      path: "/",
      referrer: `https://x.test/${"a".repeat(3000)}`,
    });
    await expect(send(big)).rejects.toMatchObject({ init: { status: 413 } });
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("answers 429 over the limit and stores nothing", async () => {
    mocks.limiter.limit.mockResolvedValue({ success: false });
    const response = await send(pageview, {
      "CF-Connecting-IP": "203.0.113.7",
    });

    expect(response.status).toBe(429);
    expect(mocks.limiter.limit).toHaveBeenCalledWith({
      key: "collect:203.0.113.7",
    });
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["Do Not Track", { DNT: "1" }],
    ["Global Privacy Control", { "Sec-GPC": "1" }],
    [
      "a crawler",
      { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" },
    ],
    ["a headless browser", { "User-Agent": `${browser} HeadlessChrome/130.0` }],
  ])(
    "counts nothing for %s, and answers as if it had",
    async (_name, headers) => {
      const response = await send(pageview, headers);

      expect(response.status).toBe(204);
      expect(mocks.recordEvent).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a body that is not JSON", "not json"],
    ["an empty body", ""],
    [
      "an event of an unknown kind",
      JSON.stringify({ kind: "keystroke", path: "/" }),
    ],
    [
      "a path with a query string",
      JSON.stringify({ kind: "pageview", path: "/search?q=secret" }),
    ],
    ["JSON that is not an object", "[1, 2]"],
    [
      "a NUL character in a path, which Postgres cannot store",
      JSON.stringify({ kind: "pageview", path: "/a\u0000b" }),
    ],
    [
      "a NUL character in a utm value",
      JSON.stringify({ kind: "pageview", path: "/", utmSource: "x\u0000" }),
    ],
    [
      "a NUL character in a referrer",
      JSON.stringify({
        kind: "pageview",
        path: "/",
        referrer: "http://h/\u0000",
      }),
    ],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await send(body);

    expect(response.status).toBe(400);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("counts nothing where the deployment did not switch the analytics on, and answers as if it had", async () => {
    mocks.enabled.mockReturnValue(false);

    const response = await send(pageview);

    expect(response.status).toBe(204);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("counts nothing without the address Cloudflare sets, and answers as if it had", async () => {
    const request = new Request("http://localhost/api/collect", {
      method: "POST",
      headers: { Origin: "http://localhost", "User-Agent": browser },
      body: pageview,
    });
    const response = (await action({
      request,
    } as Route.ActionArgs)) as Response;

    expect(response.status).toBe(204);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it.each(["PUT", "PATCH", "DELETE"])(
    "does not count a %s, and says which method it takes",
    async (method) => {
      const response = await send(pageview, {}, method);

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
      expect(mocks.recordEvent).not.toHaveBeenCalled();
    },
  );

  it("opening the address with a GET stores nothing", () => {
    const response = loader();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });
});
