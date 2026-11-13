import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * The traffic numbers of the admin dashboard (SAG-26): page views, visits, where they came from,
 * the devices, the pages people read most and the steps from a visit to a sign-up. ONE statement
 * reads them from the daily rollup `analytics_daily` (SAG-24, ADR-050) and never from the raw
 * events, so a page view costs the same on a site with a thousand visits as with a million.
 *
 * What the rollup means, so the numbers are read right:
 * - A day appears only once the nightly rollup has done it, and today is never in it. The window is
 *   the `days` days that end yesterday (UTC).
 * - A visitor is a hash that changes every day, so `visitors` of one day cannot be added to another
 *   day's to count people. The sum of the days is called *visits* here: one for each visitor and day.
 * - The `page` dimension is counted in page views (the time on a page is not an event).
 */

/** The windows the page offers, in days. */
export const trafficDays = [7, 30, 90] as const;
export type TrafficDays = (typeof trafficDays)[number];
export const defaultTrafficDays: TrafficDays = 30;

/** How many pages and sites the lists show. */
export const topSize = 10;

/**
 * The window asked in the address. Only the numbers the page offers are accepted: anything else,
 * even `30 ` with a space (`Number` reads it as 30), is the default.
 */
export function parseTrafficDays(raw: string | null): TrafficDays {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return defaultTrafficDays;
  return trafficDays.find((days) => days === Number(raw)) ?? defaultTrafficDays;
}

export type TrafficRow = { value: string; events: number; visitors: number };

export type TrafficDay = { day: string; pageviews: number; visits: number };

export type AdminTraffic = {
  days: TrafficDays;
  /** First and last day of the window, `YYYY-MM-DD`, UTC. */
  from: string;
  to: string;
  /** How many days of the window the rollup has done. A smaller number than `days` says so. */
  rolledDays: number;
  pageviews: number;
  /** One for each visitor and day. */
  visits: number;
  /** The visible time of the whole window, in milliseconds. */
  engagedMs: number;
  /** Visitors of each step, summed over the days: a visit, a sign-up, a title added, a follow. */
  funnel: { kind: string; count: number }[];
  /** The last `days` days, oldest first, with a row for the days with nothing. */
  perDay: TrafficDay[];
  /** The kinds of source, without the visits that came from inside the site. */
  sources: TrafficRow[];
  hosts: TrafficRow[];
  devices: TrafficRow[];
  pages: TrafficRow[];
};

/** The steps of the funnel, in order. */
export const funnelKinds = [
  "pageview",
  "signup",
  "add_to_library",
  "follow",
] as const;

const day = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

const count = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type Raw = Record<string, unknown>;

/** A `date` column as the client hands it over: a text, or a `Date` at midnight UTC. */
const dayOf = (value: unknown): string =>
  value instanceof Date ? day(value) : String(value).slice(0, 10);

const rowOf = (raw: Raw): TrafficRow => ({
  value: String(raw.value),
  events: count(raw.events),
  visitors: count(raw.visitors),
});

export async function getAdminTraffic(
  db: SqlExecutor,
  now: Date,
  days: TrafficDays,
): Promise<AdminTraffic> {
  const to = addDays(now, -1);
  const from = day(addDays(to, 1 - days));

  const { rows } = await db.execute(sql`
    WITH win AS (
      SELECT day, dimension, value, events, visitors, engaged_ms
      FROM analytics_daily
      WHERE day >= ${from}::date AND day <= ${day(to)}::date
        AND dimension IN ('kind', 'page', 'referrer_class', 'referrer_host', 'device')
        -- The rest of a day past the cap of the rollup is not a page or a site: summed over many
        -- days it could be the largest row and take a place of the top.
        AND NOT (dimension IN ('page', 'referrer_host') AND value = '(other)')
    ),
    totals AS (
      SELECT dimension, value,
             -- Left as bigint: a sum over 90 days of a big site could pass the range of an int.
             sum(events) AS events,
             sum(visitors) AS visitors,
             sum(engaged_ms)::float8 AS engaged_ms,
             row_number() OVER (
               PARTITION BY dimension ORDER BY sum(events) DESC, value
             ) AS place
      FROM win
      GROUP BY dimension, value
    )
    SELECT 'total' AS part, NULL::date AS day, dimension, value, events, visitors, engaged_ms
    FROM totals
    WHERE place <= CASE WHEN dimension IN ('page', 'referrer_host') THEN ${topSize}::int ELSE 100 END
    UNION ALL
    SELECT 'day', day, 'kind', value, events, visitors, engaged_ms
    FROM win WHERE dimension = 'kind' AND value = 'pageview'
    UNION ALL
    SELECT 'rolled', NULL, '', '', count(DISTINCT day)::int, 0, 0
    FROM win WHERE dimension = 'kind'
  `);

  const totals = (dimension: string) =>
    rows
      .filter((row) => row.part === "total" && row.dimension === dimension)
      .map(rowOf)
      .sort((a, b) => b.events - a.events || a.value.localeCompare(b.value));
  const kinds = totals("kind");
  const kind = (name: string) => kinds.find((row) => row.value === name);

  const seen = new Map(
    rows
      .filter((row) => row.part === "day")
      .map((row) => [dayOf(row.day), row] as const),
  );
  const perDay = Array.from({ length: days }, (_, index) => {
    const date = day(addDays(to, index + 1 - days));
    const row = seen.get(date);
    return {
      day: date,
      pageviews: count(row?.events),
      visits: count(row?.visitors),
    };
  });

  return {
    days,
    from,
    to: day(to),
    rolledDays: count(rows.find((row) => row.part === "rolled")?.events),
    pageviews: kind("pageview")?.events ?? 0,
    visits: kind("pageview")?.visitors ?? 0,
    engagedMs: count(
      rows.find(
        (row) =>
          row.part === "total" &&
          row.dimension === "kind" &&
          row.value === "engaged",
      )?.engaged_ms,
    ),
    funnel: funnelKinds.map((name) => ({
      kind: name,
      count: kind(name)?.visitors ?? 0,
    })),
    perDay,
    sources: totals("referrer_class").filter((row) => row.value !== "internal"),
    hosts: totals("referrer_host"),
    devices: totals("device"),
    pages: totals("page"),
  };
}
