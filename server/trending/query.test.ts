import { describe, expect, it } from "vitest";

import {
  parseTrendingView,
  pastYears,
  periodOf,
  trendingFirstYear,
  trendingPath,
} from "./query";

const params = (search: string) => new URLSearchParams(search);
const november2026 = new Date("2026-11-12T12:00:00Z");
const march2028 = new Date("2028-03-01T12:00:00Z");

describe("the view asked of the trending page (SAG-23)", () => {
  it("is the movies of the last week with nothing in the address", () => {
    expect(parseTrendingView(params(""), november2026)).toEqual({
      type: "movie",
      period: "week",
    });
  });

  it("takes each type and each recent period", () => {
    for (const type of ["movie", "series", "anime", "book", "manga"]) {
      expect(parseTrendingView(params(`type=${type}`), november2026).type).toBe(
        type,
      );
    }
    for (const period of ["week", "month", "year"]) {
      expect(
        parseTrendingView(params(`period=${period}`), november2026).period,
      ).toBe(period);
    }
  });

  it("falls back to the usual view for anything else", () => {
    for (const search of [
      "type=custom",
      "type=MOVIE",
      "type=",
      "type=%27%3B--",
      "period=day",
      "period=week%20",
      "period=0",
      "period=20261",
      "period=-2026",
      "period=2026%20",
      "period=%202026",
      "period=2026abc",
    ]) {
      expect(parseTrendingView(params(search), march2028)).toEqual({
        type: "movie",
        period: "week",
      });
    }
  });

  it("offers a calendar year only when it is over and SagaShelf existed", () => {
    expect(trendingFirstYear).toBe(2026);
    expect(pastYears(november2026)).toEqual([]);
    expect(pastYears(march2028)).toEqual([2027, 2026]);

    expect(parseTrendingView(params("period=2026"), november2026).period).toBe(
      "week",
    );
    expect(parseTrendingView(params("period=2026"), march2028).period).toBe(
      "2026",
    );
    // The current year is not "past", and neither is a year before the start.
    expect(parseTrendingView(params("period=2028"), march2028).period).toBe(
      "week",
    );
    expect(parseTrendingView(params("period=2025"), march2028).period).toBe(
      "week",
    );
  });

  it("turns a choice into a window of dates", () => {
    expect(periodOf("week", november2026)).toEqual({
      from: "2026-11-06",
      to: "2026-11-13",
    });
    expect(periodOf("2026", march2028)).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
    });
  });

  it("writes the address of a view, the usual one being the bare page", () => {
    expect(trendingPath({ type: "movie", period: "week" })).toBe("/trending");
    expect(trendingPath({ type: "anime", period: "week" })).toBe(
      "/trending?type=anime",
    );
    expect(trendingPath({ type: "movie", period: "2026" })).toBe(
      "/trending?period=2026",
    );
    expect(trendingPath({ type: "book", period: "month" })).toBe(
      "/trending?type=book&period=month",
    );
  });
});
