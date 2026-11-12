import { describe, expect, it } from "vitest";

import {
  maxCls,
  maxVitalMs,
  rateVital,
  vitalMetrics,
  vitalThresholds,
} from "./vitals";

describe("vitalThresholds", () => {
  it("are the ones of the web-vitals library for the three metrics", () => {
    expect(vitalMetrics).toEqual(["LCP", "CLS", "INP"]);
    expect(vitalThresholds).toEqual({
      LCP: { good: 2500, poor: 4000 },
      CLS: { good: 0.1, poor: 0.25 },
      INP: { good: 200, poor: 500 },
    });
  });

  it("leave room for a value that is bad but real below the biggest the table takes", () => {
    expect(vitalThresholds.LCP.poor).toBeLessThan(maxVitalMs);
    expect(vitalThresholds.INP.poor).toBeLessThan(maxVitalMs);
    expect(vitalThresholds.CLS.poor).toBeLessThan(maxCls);
  });
});

describe("rateVital", () => {
  it.each([
    ["LCP", 0, "good"],
    ["LCP", 2500, "good"],
    ["LCP", 2500.1, "needs-improvement"],
    ["LCP", 4000, "needs-improvement"],
    ["LCP", 4000.1, "poor"],
    ["CLS", 0.1, "good"],
    ["CLS", 0.1001, "needs-improvement"],
    ["CLS", 0.25, "needs-improvement"],
    ["CLS", 0.2501, "poor"],
    ["INP", 200, "good"],
    ["INP", 201, "needs-improvement"],
    ["INP", 500, "needs-improvement"],
    ["INP", 501, "poor"],
  ] as const)("%s of %s is %s", (metric, value, rating) => {
    expect(rateVital(metric, value)).toBe(rating);
  });
});
