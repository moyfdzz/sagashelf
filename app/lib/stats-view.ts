/**
 * What the statistics page draws, made from the numbers of the server. Kept apart from the page so
 * each rule has a test.
 */

export type YearCount = { year: number; count: number };

/**
 * The last `size` years of a series that has gaps, with a zero for each year that has nothing, so
 * the axis is a real calendar. It ends at the latest year with data and does not start before the
 * first one.
 */
export function lastYears(items: readonly YearCount[], size = 12): YearCount[] {
  if (items.length === 0) return [];
  const counts = new Map(items.map((item) => [item.year, item.count]));
  const years = items.map((item) => item.year);
  const last = Math.max(...years);
  const first = Math.max(Math.min(...years), last - size + 1);
  return Array.from({ length: last - first + 1 }, (_, index) => ({
    year: first + index,
    count: counts.get(first + index) ?? 0,
  }));
}

export type MonthCount = { year: number; month: number; count: number };

/**
 * The latest `size` years that have something, oldest first, each with its twelve months (a month
 * with nothing is zero). The first month is January.
 */
export function heatRows(
  items: readonly MonthCount[],
  size = 4,
): { year: number; months: number[] }[] {
  const years = [...new Set(items.map((item) => item.year))]
    .sort((a, b) => a - b)
    .slice(-size);
  return years.map((year) => {
    const months = Array.from({ length: 12 }, () => 0);
    for (const item of items) {
      if (item.year === year) months[item.month - 1] = item.count;
    }
    return { year, months };
  });
}

/** The year and the month with the most finished viewings; among equals the latest wins. */
export function bestPeriods(
  years: readonly YearCount[],
  months: readonly MonthCount[],
): { year: YearCount | null; month: MonthCount | null } {
  const latest = <T extends { count: number; year: number }>(
    items: readonly T[],
    later: (a: T, b: T) => boolean,
  ): T | null =>
    items.reduce<T | null>(
      (best, item) =>
        item.count > 0 &&
        (best === null ||
          item.count > best.count ||
          (item.count === best.count && later(item, best)))
          ? item
          : best,
      null,
    );
  return {
    year: latest(years, (a, b) => a.year > b.year),
    month: latest(
      months,
      (a, b) => a.year * 12 + a.month > b.year * 12 + b.month,
    ),
  };
}

/** What the genre panels read of one genre. The server type has more, which these ignore. */
export type GenreRow = {
  genre: string;
  titles: number;
  minutes: number;
  scored: number;
  averageScore: number | null;
};

/** Genres shown in a bar chart; the table under it lists all of them. */
export const genreBarCount = 10;
/** Genres shown as the best scored. */
export const bestGenreCount = 5;
/** A genre needs this many scored titles to be ranked by its mean, so one score is not a trend. */
export const bestGenreMinScored = 2;

/** The genres with the most minutes watched. A genre with no minutes (only books) is left out. */
export function topGenresByTime<T extends GenreRow>(
  rows: readonly T[],
  size = genreBarCount,
): T[] {
  return rows
    .filter((row) => row.minutes > 0)
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        b.titles - a.titles ||
        a.genre.localeCompare(b.genre),
    )
    .slice(0, size);
}

/** The genres with the most titles, books and manga included. */
export function topGenresByTitles<T extends GenreRow>(
  rows: readonly T[],
  size = genreBarCount,
): T[] {
  return [...rows]
    .sort((a, b) => b.titles - a.titles || a.genre.localeCompare(b.genre))
    .slice(0, size);
}

/** The genres with the highest mean score, among the ones with enough scored titles. */
export function bestScoredGenres<T extends GenreRow>(
  rows: readonly T[],
  size = bestGenreCount,
  minScored = bestGenreMinScored,
): T[] {
  return rows
    .filter((row) => row.averageScore !== null && row.scored >= minScored)
    .sort(
      (a, b) =>
        (b.averageScore ?? 0) - (a.averageScore ?? 0) ||
        b.scored - a.scored ||
        a.genre.localeCompare(b.genre),
    )
    .slice(0, size);
}

/** Minutes as days, with one decimal at most: 1 440 minutes make a day. */
export const minutesToDays = (minutes: number) => minutes / 1440;

/** Minutes as hours, for the length of one title. */
export const minutesToHours = (minutes: number) => minutes / 60;
