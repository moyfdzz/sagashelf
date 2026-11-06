import { describe, expect, it } from "vitest";

import {
  adminTimeZone,
  formatDate,
  formatList,
  formatNumber,
  formatRelativeTime,
} from "./format";

const date = new Date("2026-10-20T23:30:00Z");

describe("formatDate", () => {
  it("uses the active language", () => {
    expect(formatDate(date, "es")).toBe("20 de octubre de 2026");
    expect(formatDate(date, "en")).toBe("October 20, 2026");
  });

  it("uses a fixed time zone so server and browser agree", () => {
    expect(formatDate(date, "en", { dateStyle: "short" }, "Asia/Tokyo")).toBe(
      "10/21/26",
    );
    expect(formatDate(date, "en", { dateStyle: "short" })).toBe("10/20/26");
  });
});

describe("adminTimeZone (SAG-154)", () => {
  it("is Monterrey: 22:35 UTC is 16:35, in both languages, and the day can change", () => {
    const at = new Date("2026-11-06T22:35:00Z");
    const options = { timeStyle: "short" } as const;

    expect(formatDate(at, "en", options, adminTimeZone)).toBe("4:35 PM");
    expect(formatDate(at, "es", options, adminTimeZone)).toBe("16:35");
    // 03:00 UTC is still the day before in Monterrey.
    expect(
      formatDate(
        new Date("2026-11-07T03:00:00Z"),
        "en",
        { dateStyle: "short" },
        adminTimeZone,
      ),
    ).toBe("11/6/26");
  });
});

describe("formatNumber", () => {
  it("uses the separators of each language", () => {
    expect(formatNumber(1234567.5, "es-MX")).toBe("1,234,567.5");
    expect(formatNumber(1234567.5, "en")).toBe("1,234,567.5");
    expect(formatNumber(1234567.5, "es")).toBe("1.234.567,5");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("picks the unit that fits", () => {
    expect(
      formatRelativeTime(new Date("2026-10-17T12:00:00Z"), "en", now),
    ).toBe("3 days ago");
    expect(
      formatRelativeTime(new Date("2026-10-17T12:00:00Z"), "es", now),
    ).toBe("hace 3 días");
    expect(
      formatRelativeTime(new Date("2026-10-20T14:00:00Z"), "en", now),
    ).toBe("in 2 hours");
  });

  it("uses natural words for the nearest day", () => {
    expect(
      formatRelativeTime(new Date("2026-10-19T12:00:00Z"), "en", now),
    ).toBe("yesterday");
    expect(
      formatRelativeTime(new Date("2026-10-19T12:00:00Z"), "es", now),
    ).toBe("ayer");
  });
});

describe("formatList", () => {
  it("writes a list the way the language does", () => {
    expect(formatList(["Acción", "Drama", "Misterio"], "es")).toBe(
      "Acción, Drama y Misterio",
    );
    expect(formatList(["Action", "Drama", "Mystery"], "en")).toBe(
      "Action, Drama, and Mystery",
    );
  });

  it("says two with a word, one alone, and an empty list as nothing", () => {
    expect(formatList(["Acción", "Drama"], "es")).toBe("Acción y Drama");
    expect(formatList(["Action", "Drama"], "en")).toBe("Action and Drama");
    expect(formatList(["Acción"], "es")).toBe("Acción");
    expect(formatList([], "es")).toBe("");
  });
});
