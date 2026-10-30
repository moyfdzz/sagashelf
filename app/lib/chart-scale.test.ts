import { describe, expect, it } from "vitest";

import { axisTicks, heatLevel, niceMax } from "./chart-scale";

describe("niceMax", () => {
  it("rounds up to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(18)).toBe(20);
    expect(niceMax(40)).toBe(50);
    expect(niceMax(51)).toBe(100);
    expect(niceMax(0.3)).toBeCloseTo(0.5);
  });

  it("is 1 for nothing, so an empty chart still has an axis", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-4)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
  });
});

describe("axisTicks", () => {
  it("has the middle when it is a whole number", () => {
    expect(axisTicks(20)).toEqual([0, 10, 20]);
    expect(axisTicks(1)).toEqual([0, 1]);
    expect(axisTicks(5)).toEqual([0, 5]);
  });
});

describe("heatLevel", () => {
  it("is 0 for nothing and at least 1 for anything", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 1000)).toBe(1);
  });

  it("reaches the top level at the largest value", () => {
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(3, 0)).toBe(0);
  });
});
