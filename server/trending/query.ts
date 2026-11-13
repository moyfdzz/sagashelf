import {
  calendarYear,
  isPeriodKind,
  recentPeriod,
  type Period,
} from "../db/site-favorites";
import { isStatsType, type StatsType } from "../db/stats";

/**
 * What the `/trending` page asks for, read from its address (SAG-23). Anything that is not one of
 * the known values means the default, so a made-up address shows the usual page and nothing a
 * visitor types reaches a query.
 */

/** The year SagaShelf started: the first one the selector can offer as a past year. */
export const trendingFirstYear = 2026;

export const defaultType: StatsType = "movie";
export const defaultPeriod = "week";

/** `week`, `month` or `year` (the last 7, 30 or 365 days), or a closed calendar year like `2026`. */
export type PeriodChoice = string;

export type TrendingView = { type: StatsType; period: PeriodChoice };

/** The calendar years that are over, the latest first. Empty until the second year. */
export function pastYears(now: Date): number[] {
  const years: number[] = [];
  for (
    let year = now.getUTCFullYear() - 1;
    year >= trendingFirstYear;
    year -= 1
  ) {
    years.push(year);
  }
  return years;
}

export function parseTrendingView(
  params: URLSearchParams,
  now: Date,
): TrendingView {
  const type = params.get("type");
  const period = params.get("period");
  return {
    type: isStatsType(type) ? type : defaultType,
    period:
      isPeriodKind(period) ||
      (period !== null &&
        /^\d{4}$/.test(period) &&
        pastYears(now).includes(Number(period)))
        ? (period as PeriodChoice)
        : defaultPeriod,
  };
}

/** The window of time a choice stands for. */
export const periodOf = (choice: PeriodChoice, now: Date): Period =>
  isPeriodKind(choice)
    ? recentPeriod(choice, now)
    : calendarYear(Number(choice));

/** The address of a view: the default one is the bare `/trending`. */
export function trendingPath(view: TrendingView): string {
  const params = new URLSearchParams();
  if (view.type !== defaultType) params.set("type", view.type);
  if (view.period !== defaultPeriod) params.set("period", view.period);
  const query = params.toString();
  return query ? `/trending?${query}` : "/trending";
}
