import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * The numbers of the first screen of the admin dashboard (SAG-26): how many people use the app, how
 * many joined lately, how many were active and how much they track. ONE statement reads it, from
 * the small tables only (`users` and `library_entries`), never from the raw analytics events.
 *
 * Every window is a rolling one, counted in whole days of UTC up to and including today: "today",
 * "the last 7 days", "the last 30 days" and "the last 365 days". A person is *active* when they
 * changed something in their library in the window (any entry created or updated), which is the only
 * activity the database holds per person (the analytics have no person in them, ADR-050). A deleted
 * account counts nowhere.
 */

/** How many days the chart of new people shows. */
export const signupDays = 30;

export type DailySignups = { day: string; count: number };

export type AdminOverview = {
  totalUsers: number;
  newToday: number;
  newLast30Days: number;
  newLast365Days: number;
  activeLast7Days: number;
  activeLast30Days: number;
  /** Rows of `library_entries`: what people track, counted once for each person and title. */
  entriesTracked: number;
  /** The different titles that at least one person tracks. */
  titlesTracked: number;
  /** The last `signupDays` days, oldest first, with a row for the days nobody joined. */
  signups: DailySignups[];
};

const day = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

/** The start of a UTC day, as the text the database reads as a moment. */
const startOf = (date: Date) => `${day(date)}T00:00:00Z`;

const count = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The `json` column as the client hands it over: already parsed, or as text. */
function readSignups(value: unknown): DailySignups[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map((row: { day?: unknown; count?: unknown }) => ({
    day: String(row.day).slice(0, 10),
    count: count(row.count),
  }));
}

export async function getAdminOverview(
  db: SqlExecutor,
  now: Date,
): Promise<AdminOverview> {
  const today = startOf(now);
  const start30 = startOf(addDays(now, 1 - signupDays));
  const start365 = startOf(addDays(now, -364));
  const start7 = startOf(addDays(now, -6));

  const { rows } = await db.execute(sql`
    WITH people AS (
      SELECT id, created_at FROM users WHERE deleted_at IS NULL
    ),
    activity AS (
      SELECT le.user_id, le.media_id,
             GREATEST(le.created_at, le.updated_at) AS touched_at
      FROM library_entries le
      JOIN people p ON p.id = le.user_id
    ),
    days AS (
      -- Whole dates, so a change of time zone or of daylight saving cannot add or drop a row.
      SELECT series.moment::date AS day
      FROM generate_series(
        ${start30.slice(0, 10)}::date, ${today.slice(0, 10)}::date, interval '1 day'
      ) AS series(moment)
    ),
    per_day AS (
      SELECT days.day,
             count(p.id)::int AS count
      FROM days
      LEFT JOIN people p ON (p.created_at AT TIME ZONE 'UTC')::date = days.day
      GROUP BY days.day
    )
    SELECT
      (SELECT count(*)::int FROM people) AS total_users,
      (SELECT count(*)::int FROM people WHERE created_at >= ${today}::timestamptz) AS new_today,
      (SELECT count(*)::int FROM people WHERE created_at >= ${start30}::timestamptz) AS new_30,
      (SELECT count(*)::int FROM people WHERE created_at >= ${start365}::timestamptz) AS new_365,
      (SELECT count(DISTINCT user_id)::int FROM activity WHERE touched_at >= ${start7}::timestamptz) AS active_7,
      (SELECT count(DISTINCT user_id)::int FROM activity WHERE touched_at >= ${start30}::timestamptz) AS active_30,
      (SELECT count(*)::int FROM activity) AS entries,
      (SELECT count(DISTINCT media_id)::int FROM activity) AS titles,
      (SELECT coalesce(json_agg(json_build_object('day', day, 'count', count) ORDER BY day), '[]'::json) FROM per_day) AS signups
  `);

  const row = rows[0] ?? {};
  return {
    totalUsers: count(row.total_users),
    newToday: count(row.new_today),
    newLast30Days: count(row.new_30),
    newLast365Days: count(row.new_365),
    activeLast7Days: count(row.active_7),
    activeLast30Days: count(row.active_30),
    entriesTracked: count(row.entries),
    titlesTracked: count(row.titles),
    signups: readSignups(row.signups),
  };
}
