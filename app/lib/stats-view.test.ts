import { describe, expect, it } from "vitest";

import { heatRows, lastYears, minutesToDays } from "./stats-view";

describe("lastYears", () => {
  it("is empty for nothing", () => {
    expect(lastYears([])).toEqual([]);
  });

  it("fills the years in between with zero", () => {
    expect(
      lastYears([
        { year: 2020, count: 3 },
        { year: 2023, count: 1 },
      ]),
    ).toEqual([
      { year: 2020, count: 3 },
      { year: 2021, count: 0 },
      { year: 2022, count: 0 },
      { year: 2023, count: 1 },
    ]);
  });

  it("keeps the latest years only, ending at the latest one with data", () => {
    const years = lastYears(
      [
        { year: 1970, count: 9 },
        { year: 2020, count: 1 },
      ],
      3,
    );

    expect(years.map((entry) => entry.year)).toEqual([2018, 2019, 2020]);
  });

  it("does not start before the first year with data", () => {
    expect(lastYears([{ year: 2024, count: 2 }], 12)).toEqual([
      { year: 2024, count: 2 },
    ]);
  });
});

describe("heatRows", () => {
  it("gives each year its twelve months, with zero for the empty ones", () => {
    const rows = heatRows([
      { year: 2025, month: 3, count: 2 },
      { year: 2025, month: 12, count: 1 },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.year).toBe(2025);
    expect(rows[0]?.months).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("keeps the latest years, oldest first", () => {
    const items = [2020, 2021, 2022, 2023, 2024, 2025].map((year) => ({
      year,
      month: 1,
      count: 1,
    }));

    expect(heatRows(items, 3).map((row) => row.year)).toEqual([
      2023, 2024, 2025,
    ]);
  });

  it("is empty for nothing", () => {
    expect(heatRows([])).toEqual([]);
  });
});

describe("minutesToDays", () => {
  it("turns minutes into days", () => {
    expect(minutesToDays(1440)).toBe(1);
    expect(minutesToDays(720)).toBe(0.5);
    expect(minutesToDays(0)).toBe(0);
  });
});
