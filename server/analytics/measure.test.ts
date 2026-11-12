import { beforeEach, describe, expect, it, vi } from "vitest";

import { isMeasured } from "./measure";

const mocks = vi.hoisted(() => ({ enabled: vi.fn<() => boolean>() }));
vi.mock("../runtime-env", () => ({ getAnalyticsEnabled: mocks.enabled }));

const browser =
  "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://sagashelf.app/", {
    headers: {
      "User-Agent": browser,
      "CF-Connecting-IP": "203.0.113.7",
      ...headers,
    },
  });

beforeEach(() => {
  mocks.enabled.mockReset().mockReturnValue(true);
});

describe("isMeasured", () => {
  it("measures a person, a visitor included, where the analytics are on", () => {
    expect(isMeasured(request())).toBe(true);
    expect(isMeasured(request(), null)).toBe(true);
    expect(isMeasured(request(), { role: "user" })).toBe(true);
    expect(isMeasured(request(), { role: "moderator" })).toBe(true);
  });

  it("measures nothing where the deployment did not switch the analytics on", () => {
    mocks.enabled.mockReturnValue(false);

    expect(isMeasured(request())).toBe(false);
    expect(isMeasured(request(), { role: "user" })).toBe(false);
  });

  it("does not measure an administrator, so the owner is not counted", () => {
    expect(isMeasured(request(), { role: "admin" })).toBe(false);
  });

  it.each([
    ["Do Not Track", { DNT: "1" }],
    ["Global Privacy Control", { "Sec-GPC": "1" }],
    ["a robot", { "User-Agent": "Googlebot/2.1" }],
  ])("does not measure %s", (_name, headers) => {
    expect(isMeasured(request(headers))).toBe(false);
  });
});
