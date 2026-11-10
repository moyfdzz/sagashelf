import type { SqlExecutor } from "./clerk-sync";
import {
  claimDailyUnit,
  refundDailyUnits,
  type DailyClaim,
  type DailyColumns,
} from "./daily-counter";

/**
 * Titles one person may make us fetch from a provider in a UTC day (SAG-239, ADR-035). It protects
 * the quota of the providers and the size of the database. The per-minute limit stays in the
 * Workers binding; this one is counted by person only, so a new address gives no new budget.
 */
export const titleFetchesPerDay = 300;

export type TitleClaim = DailyClaim;

const columns: DailyColumns = {
  day: "title_fetches_day",
  count: "title_fetches_count",
};

/**
 * Takes one of the fetches the person has today, before a provider is asked. A fetch that the
 * provider answered (even with "not found") stays spent: the call was made. One that failed because
 * the provider did not answer is given back with `refundTitleFetches`.
 */
export const claimTitleFetch = (db: SqlExecutor, userId: string) =>
  claimDailyUnit(db, userId, columns, titleFetchesPerDay);

/** Gives back fetches the provider did not answer, so a provider outage does not use the budget. */
export const refundTitleFetches = (
  db: SqlExecutor,
  userId: string,
  units: number,
) => refundDailyUnits(db, userId, columns, units);
