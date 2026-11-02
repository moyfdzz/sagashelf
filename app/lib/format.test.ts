import { describe, expect, it } from "vitest";

import {
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
