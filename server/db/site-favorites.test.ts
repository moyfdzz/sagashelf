import { describe, expect, it } from "vitest";

import { calendarYear, isPeriodKind, recentPeriod } from "./site-favorites";

describe("the periods of the favorites (SAG-23)", () => {
  const now = new Date("2026-11-12T23:30:00Z");

  it("takes the last 7, 30 and 365 days, today included", () => {
    expect(recentPeriod("week", now)).toEqual({
      from: "2026-11-06",
      to: "2026-11-13",
    });
    expect(recentPeriod("month", now)).toEqual({
      from: "2026-10-14",
      to: "2026-11-13",
    });
    expect(recentPeriod("year", now)).toEqual({
      from: "2025-11-13",
      to: "2026-11-13",
    });
  });

  it("counts the days in UTC, not in the time zone of the server", () => {
    expect(recentPeriod("week", new Date("2026-01-01T00:00:00Z"))).toEqual({
      from: "2025-12-26",
      to: "2026-01-02",
    });
  });

  it("gives a whole calendar year", () => {
    expect(calendarYear(2025)).toEqual({
      from: "2025-01-01",
      to: "2026-01-01",
    });
    expect(calendarYear(999)).toEqual({ from: "0999-01-01", to: "1000-01-01" });
  });

  it("knows the three kinds", () => {
    expect(["week", "month", "year"].every(isPeriodKind)).toBe(true);
    expect(isPeriodKind("day")).toBe(false);
    expect(isPeriodKind(undefined)).toBe(false);
  });
});
