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

/** Minutes as days, with one decimal at most: 1 440 minutes make a day. */
export const minutesToDays = (minutes: number) => minutes / 1440;
