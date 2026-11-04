import { describe, expect, it } from "vitest";

import { asDate } from "./dates";

describe("asDate", () => {
  it("returns the same Date it was given, with its milliseconds", () => {
    const at = new Date("2026-11-04T10:00:00.123Z");

    expect(asDate(at)).toBe(at);
  });

  it("reads the string a timestamp column comes as over HTTP", () => {
    expect(asDate("2026-11-04T10:00:00.000Z").getTime()).toBe(
      Date.UTC(2026, 10, 4, 10, 0, 0),
    );
    expect(asDate("2026-11-04 10:00:00+00").getTime()).toBe(
      Date.UTC(2026, 10, 4, 10, 0, 0),
    );
  });

  it("is an invalid date, and does not throw, for what is not a date", () => {
    expect(Number.isNaN(asDate("not a date").getTime())).toBe(true);
    expect(Number.isNaN(asDate(undefined).getTime())).toBe(true);
  });
});
