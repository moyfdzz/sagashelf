import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { levelAllowed } from "./person-visibility";
import { isStatsType, type StatsType } from "./stats";
import { localizedTitleSql, sharedTitleSql } from "./titles";
import type { Locale } from "../providers/types";
import { canView } from "../social/can-view";

/**
 * The favorites of SagaShelf (SAG-23, ADR-051): what the people of the site added, completed and
 * rated most, per type and period. ONE function reads it, on request, so a person who later makes an
 * entry private or deletes the account is gone from the next answer. A rollup table or an edge copy
 * can replace the body later without touching who calls it (the `/trending` page, the admin
 * dashboard of SAG-26).
 *
 * Only public things count: an entry whose level is `public` that belongs to a person whose profile
 * is `public`, the same rule `canView` gives a visitor who is signed out. Nothing is ever shown for
 * fewer than `minPeople` different people, so a title cannot point at one person.
 */

/** A title or an average appears only when at least this many different people stand behind it. */
export const minPeople = 3;

/** How many titles each list shows. */
export const listSize = 10;

/**
 * The weight of the Bayesian average, in ratings: a title with a few ratings is pulled towards the
 * mean of its type and period, and with many it is its own mean. With the minimum of three people
 * a title of three tens does not beat a title of thirty nines.
 */
export const bayesianWeight = 5;

/** Which window of time is asked, as `from` (included) to `to` (not included), `YYYY-MM-DD`, UTC. */
export type Period = { from: string; to: string };

export type PeriodKind = "week" | "month" | "year";

export const periodKinds: readonly PeriodKind[] = ["week", "month", "year"];

export const isPeriodKind = (value: unknown): value is PeriodKind =>
  typeof value === "string" &&
  (periodKinds as readonly string[]).includes(value);

const day = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

/**
 * The last 7, 30 or 365 days up to and including today (UTC). A rolling window and not a calendar
 * one, so the first day of a week or a month does not start with an empty list.
 */
export function recentPeriod(kind: PeriodKind, now: Date): Period {
  const days = { week: 7, month: 30, year: 365 }[kind];
  return { from: day(addDays(now, 1 - days)), to: day(addDays(now, 1)) };
}

/** A whole calendar year, for "best of 2025". */
export const calendarYear = (year: number): Period => ({
  from: `${String(year).padStart(4, "0")}-01-01`,
  to: `${String(year + 1).padStart(4, "0")}-01-01`,
});

export type FavoriteTitle = {
  mediaId: string;
  title: string;
  type: string;
  year: number | null;
  imageUrl: string | null;
  /** How many different people added, completed or rated it in the period. */
  people: number;
  /** The mean of the ratings, only in the list of the best rated. */
  average: number | null;
};

export type SiteFavorites = {
  mostAdded: FavoriteTitle[];
  mostCompleted: FavoriteTitle[];
  /** Ranked by the Bayesian average, not by the plain mean. */
  bestRated: FavoriteTitle[];
};

const lists = {
  added: "mostAdded",
  completed: "mostCompleted",
  rated: "bestRated",
} as const;

/**
 * A date counts for a list like this: "added" when the entry was created, "completed" on the
 * finish date the person wrote (an entry with no date is in no period), and a rating on the finish
 * date or, without one, the day the entry was created, since a score has no date of its own.
 */
export async function getSiteFavorites(
  db: SqlExecutor,
  type: StatsType,
  period: Period,
  locale: Locale,
): Promise<SiteFavorites> {
  // The type comes from a route and reaches the statement as a bound value, but it is checked
  // here too: the function is the one place that decides what may be asked.
  if (!isStatsType(type)) throw new Error("Unknown type of title");
  const publicEntry = levelAllowed(sql`le.visibility`, (level) =>
    canView("signed_out", level, "public"),
  );
  const publicProfile = levelAllowed(sql`u.privacy`, (profile) =>
    canView("signed_out", "public", profile),
  );

  const { rows } = await db.execute(sql`
    WITH p AS (
      SELECT le.media_id, le.status::text AS status, le.score,
             (le.created_at AT TIME ZONE 'UTC')::date AS added_on,
             le.finished_at AS finished_on
      FROM library_entries le
      JOIN users u ON u.id = le.user_id
      JOIN media_items m ON m.id = le.media_id
      WHERE m.type = ${type}::media_type
        -- The type asked is never custom, so this rule changes no answer today. It stays so that
        -- the day a custom title can be shared (SAG-19) the one rule decides, not this query.
        AND ${sharedTitleSql("m")}
        AND u.deleted_at IS NULL
        AND ${publicEntry}
        AND ${publicProfile}
    ),
    added AS (
      SELECT media_id, count(*)::int AS people, NULL::float8 AS average, 0::float8 AS rank_by
      FROM p
      WHERE added_on >= ${period.from}::date AND added_on < ${period.to}::date
      GROUP BY media_id
      HAVING count(*) >= ${minPeople}
    ),
    completed AS (
      SELECT media_id, count(*)::int AS people, NULL::float8 AS average, 0::float8 AS rank_by
      FROM p
      WHERE status = 'completed'
        AND finished_on >= ${period.from}::date AND finished_on < ${period.to}::date
      GROUP BY media_id
      HAVING count(*) >= ${minPeople}
    ),
    scored AS (
      SELECT media_id, score FROM p
      WHERE score IS NOT NULL
        AND coalesce(finished_on, added_on) >= ${period.from}::date
        AND coalesce(finished_on, added_on) < ${period.to}::date
    ),
    rated AS (
      SELECT s.media_id, count(*)::int AS people, avg(s.score)::float8 AS average,
             ((count(*) * avg(s.score)
               + ${bayesianWeight} * (SELECT avg(score) FROM scored))
              / (count(*) + ${bayesianWeight}))::float8 AS rank_by
      FROM scored s
      GROUP BY s.media_id
      HAVING count(*) >= ${minPeople}
    ),
    ranked AS (
      SELECT 'added' AS list, media_id, people, average,
             row_number() OVER (ORDER BY people DESC, media_id) AS rn
      FROM added
      UNION ALL
      SELECT 'completed', media_id, people, average,
             row_number() OVER (ORDER BY people DESC, media_id)
      FROM completed
      UNION ALL
      SELECT 'rated', media_id, people, average,
             row_number() OVER (ORDER BY rank_by DESC, people DESC, media_id)
      FROM rated
    )
    SELECT r.list, r.people, r.average, r.media_id, ${localizedTitleSql("m", locale)} AS title,
           m.type::text AS type, m.year, m.image_url
    FROM ranked r
    JOIN media_items m ON m.id = r.media_id
    WHERE r.rn <= ${listSize} AND ${sharedTitleSql("m")}
    ORDER BY r.list, r.rn
  `);

  const favorites: SiteFavorites = {
    mostAdded: [],
    mostCompleted: [],
    bestRated: [],
  };
  for (const row of rows) {
    const key = lists[String(row.list) as keyof typeof lists];
    favorites[key].push({
      mediaId: String(row.media_id),
      title: String(row.title),
      type: String(row.type),
      year: row.year === null ? null : Number(row.year),
      imageUrl: row.image_url === null ? null : String(row.image_url),
      people: Number(row.people),
      average: row.average === null ? null : Number(row.average),
    });
  }
  return favorites;
}
