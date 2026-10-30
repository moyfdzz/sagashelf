import { describe, expect, it } from "vitest";

import {
  bestPeriods,
  bestScoredGenres,
  heatRows,
  lastYears,
  minutesToDays,
  minutesToHours,
  topGenresByTime,
  topGenresByTitles,
} from "./stats-view";

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

describe("minutesToHours", () => {
  it("turns minutes into hours", () => {
    expect(minutesToHours(120)).toBe(2);
    expect(minutesToHours(90)).toBe(1.5);
  });
});

describe("bestPeriods", () => {
  it("has no year and no month for nothing", () => {
    expect(bestPeriods([], [])).toEqual({ year: null, month: null });
  });

  it("picks the year and the month with the most finished viewings", () => {
    const best = bestPeriods(
      [
        { year: 2024, count: 1 },
        { year: 2025, count: 5 },
      ],
      [
        { year: 2024, month: 5, count: 1 },
        { year: 2025, month: 3, count: 4 },
        { year: 2025, month: 6, count: 1 },
      ],
    );

    expect(best.year).toEqual({ year: 2025, count: 5 });
    expect(best.month).toEqual({ year: 2025, month: 3, count: 4 });
  });

  it("takes the latest period among equals", () => {
    const best = bestPeriods(
      [
        { year: 2023, count: 2 },
        { year: 2025, count: 2 },
        { year: 2024, count: 2 },
      ],
      [
        { year: 2024, month: 12, count: 2 },
        { year: 2025, month: 1, count: 2 },
        { year: 2024, month: 3, count: 2 },
      ],
    );

    expect(best.year?.year).toBe(2025);
    expect(best.month).toMatchObject({ year: 2025, month: 1 });
  });

  it("does not pick a period with nothing in it", () => {
    expect(
      bestPeriods(
        [{ year: 2025, count: 0 }],
        [{ year: 2025, month: 1, count: 0 }],
      ),
    ).toEqual({ year: null, month: null });
  });
});

describe("the genres of the statistics page (SAG-86)", () => {
  const row = (
    genre: string,
    titles: number,
    minutes: number,
    scored = 0,
    averageScore: number | null = null,
  ) => ({ genre, titles, minutes, scored, averageScore });

  describe("topGenresByTime", () => {
    it("puts the genre with the most minutes first, then the one with more titles, then by name", () => {
      const rows = [
        row("drama", 3, 600),
        row("action", 5, 900),
        row("comedy", 4, 600),
        row("horror", 4, 600),
      ];

      expect(topGenresByTime(rows).map((r) => r.genre)).toEqual([
        "action",
        "comedy",
        "horror",
        "drama",
      ]);
    });

    it("leaves out a genre with no minutes, such as one that only books have", () => {
      expect(
        topGenresByTime([row("biography", 4, 0), row("drama", 1, 90)]).map(
          (r) => r.genre,
        ),
      ).toEqual(["drama"]);
    });

    it("keeps only the first ten, and does not change the list it was given", () => {
      const rows = Array.from({ length: 12 }, (_, index) =>
        row(`genre_${String(index).padStart(2, "0")}`, 1, 100 + index),
      );
      const before = rows.map((r) => r.genre);

      const top = topGenresByTime(rows);

      expect(top).toHaveLength(10);
      expect(top[0]?.genre).toBe("genre_11");
      expect(rows.map((r) => r.genre)).toEqual(before);
    });
  });

  describe("topGenresByTitles", () => {
    it("counts books and manga too, and breaks a tie by name", () => {
      const rows = [
        row("drama", 2, 0),
        row("action", 2, 500),
        row("isekai", 6, 0),
      ];

      expect(topGenresByTitles(rows).map((r) => r.genre)).toEqual([
        "isekai",
        "action",
        "drama",
      ]);
    });

    it("keeps only the first ten", () => {
      const rows = Array.from({ length: 11 }, (_, index) =>
        row(`g${index}`, index + 1, 0),
      );

      expect(topGenresByTitles(rows)).toHaveLength(10);
    });
  });

  describe("bestScoredGenres", () => {
    it("ranks by the mean score, and needs two scored titles so one score is not a trend", () => {
      const rows = [
        row("drama", 4, 0, 1, 10),
        row("action", 4, 0, 3, 8.5),
        row("comedy", 4, 0, 2, 9),
        row("horror", 4, 0, 0, null),
      ];

      expect(bestScoredGenres(rows).map((r) => r.genre)).toEqual([
        "comedy",
        "action",
      ]);
    });

    it("breaks a tie by the number of scored titles and then by name, and keeps five", () => {
      const rows = [
        row("b", 2, 0, 2, 7),
        row("a", 2, 0, 2, 7),
        row("c", 3, 0, 3, 7),
        row("d", 2, 0, 2, 6),
        row("e", 2, 0, 2, 5),
        row("f", 2, 0, 2, 4),
      ];

      expect(bestScoredGenres(rows).map((r) => r.genre)).toEqual([
        "c",
        "a",
        "b",
        "d",
        "e",
      ]);
    });

    it("is empty when no genre has enough scored titles", () => {
      expect(bestScoredGenres([row("drama", 1, 0, 1, 9)])).toEqual([]);
      expect(bestScoredGenres([])).toEqual([]);
    });
  });
});
