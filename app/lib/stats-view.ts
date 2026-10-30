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

/** Minutes as days, with one decimal at most: 1 440 minutes make a day. */
export const minutesToDays = (minutes: number) => minutes / 1440;

/** Minutes as hours, for the length of one title. */
export const minutesToHours = (minutes: number) => minutes / 60;
