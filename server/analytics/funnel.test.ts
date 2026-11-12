import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectEvent } from "./event";
import { recordFunnelEvent } from "./funnel";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn<() => boolean>(),
  getDb: vi.fn(),
  recordEvent:
    vi.fn<
      (
        db: unknown,
        request: Request,
        event: CollectEvent,
        now: Date,
      ) => Promise<void>
    >(),
  logUnhandled: vi.fn(),
  background: [] as Promise<unknown>[],
}));

vi.mock("../runtime-env", () => ({
  getAnalyticsEnabled: mocks.enabled,
  getDb: mocks.getDb,
  runInBackground: (work: Promise<unknown>) => mocks.background.push(work),
}));
vi.mock("./record", () => ({ recordEvent: mocks.recordEvent }));
vi.mock("../http/error-log", () => ({ logUnhandled: mocks.logUnhandled }));

const browser =
  "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

function post(headers: Record<string, string> = {}) {
  return new Request("https://sagashelf.app/library/add", {
    method: "POST",
    headers: {
      "User-Agent": browser,
      "CF-Connecting-IP": "203.0.113.7",
      ...headers,
    },
  });
}

const added = { kind: "add_to_library", path: "/library/add" } as const;
const person = { role: "user" };

/** Waits for the work the function left for after the answer. */
const settled = () => Promise.all(mocks.background);

beforeEach(() => {
  mocks.enabled.mockReset().mockReturnValue(true);
  mocks.getDb.mockReset().mockResolvedValue({});
  mocks.recordEvent.mockReset().mockResolvedValue(undefined);
  mocks.logUnhandled.mockReset();
  mocks.background.length = 0;
});

describe("recordFunnelEvent", () => {
  it("records the step after the answer, with the request of the person", async () => {
    const request = post();

    recordFunnelEvent(request, person, added);
    await settled();

    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
    const [, sent, event, when] = mocks.recordEvent.mock.calls[0] ?? [];
    expect(sent).toBe(request);
    expect(event).toEqual(added);
    expect(when).toBeInstanceOf(Date);
  });

  it("does not make the action wait: the work is handed to the background", () => {
    recordFunnelEvent(post(), person, added);

    expect(mocks.background).toHaveLength(1);
  });

  it("records nothing where the deployment did not switch the analytics on", async () => {
    mocks.enabled.mockReturnValue(false);

    recordFunnelEvent(post(), person, added);
    await settled();

    expect(mocks.recordEvent).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.background).toHaveLength(0);
  });

  it("does not count an administrator, so the owner is not measured", async () => {
    recordFunnelEvent(post(), { role: "admin" }, added);
    await settled();

    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("counts a moderator, who is an ordinary visitor for the numbers", async () => {
    recordFunnelEvent(post(), { role: "moderator" }, added);
    await settled();

    expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Do Not Track", { DNT: "1" }],
    ["Global Privacy Control", { "Sec-GPC": "1" }],
    ["a robot", { "User-Agent": "Googlebot/2.1" }],
    ["a headless browser", { "User-Agent": `${browser} HeadlessChrome/130.0` }],
  ])("records nothing for %s", async (_name, headers) => {
    recordFunnelEvent(post(headers), person, added);
    await settled();

    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing for a call without the address Cloudflare sets", async () => {
    const request = new Request("https://sagashelf.app/library/add", {
      method: "POST",
      headers: { "User-Agent": browser },
    });

    recordFunnelEvent(request, person, added);
    await settled();

    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("logs a failure without values and never lets it reach the person", async () => {
    const failure = new Error(
      "connection refused: postgres://user:pass@host/db",
    );
    mocks.recordEvent.mockRejectedValue(failure);
    const request = post();

    expect(() => recordFunnelEvent(request, person, added)).not.toThrow();
    await expect(settled()).resolves.toBeDefined();

    expect(mocks.logUnhandled).toHaveBeenCalledWith(failure, request);
  });

  it("logs the failure of the database too", async () => {
    mocks.getDb.mockRejectedValue(new Error("DATABASE_URL is not set"));

    recordFunnelEvent(post(), person, added);
    await settled();

    expect(mocks.logUnhandled).toHaveBeenCalledTimes(1);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });
});
