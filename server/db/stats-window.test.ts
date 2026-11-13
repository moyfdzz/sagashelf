import { describe, expect, it } from "vitest";

import { addDays, readDay, toCount, utcDay } from "./stats-window";

describe("the rules the statistics share (SAG-26)", () => {
  it("takes the day in UTC, whatever the zone of the server", () => {
    expect(utcDay(new Date("2026-11-12T23:59:59Z"))).toBe("2026-11-12");
    expect(utcDay(new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
  });

  it("moves a moment by whole days, forwards and backwards", () => {
    const moment = new Date("2026-11-12T15:00:00Z");

    expect(utcDay(addDays(moment, 1))).toBe("2026-11-13");
    expect(utcDay(addDays(moment, -12))).toBe("2026-10-31");
    expect(utcDay(addDays(moment, 0))).toBe("2026-11-12");
  });

  it("reads a number given as a number or as text, and anything else as zero", () => {
    expect(toCount(5)).toBe(5);
    expect(toCount("12")).toBe(12);
    expect(toCount("250.5")).toBe(250.5);
    for (const value of ["abc", undefined, NaN, Infinity]) {
      expect(toCount(value)).toBe(0);
    }
    expect(toCount(null)).toBe(0);
  });

  it("reads a day from a text or a Date, and says nothing for what is not a day", () => {
    expect(readDay("2026-11-12")).toBe("2026-11-12");
    expect(readDay("2026-11-12T00:00:00")).toBe("2026-11-12");
    expect(readDay(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
    for (const value of [undefined, null, "undefined", "", "12 nov", {}]) {
      expect(readDay(value)).toBeNull();
    }
  });
});
