import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/** The two columns of `users` that hold a per-person counter of one UTC day. */
export type DailyColumns = { day: string; count: string };

export type DailyClaim = "ok" | "limit" | "gone";

const today = sql`(now() AT TIME ZONE 'utc')::date`;

/**
 * Takes one unit of a per-person daily counter. One statement checks the count and adds to it, so
 * requests sent together cannot pass the limit. The counter starts again on a new UTC day. Written
 * once for every daily budget (the picture tries and the titles from a provider, ADR-033); the
 * column names are fixed by the caller, never by a request.
 */
export async function claimDailyUnit(
  db: SqlExecutor,
  userId: string,
  columns: DailyColumns,
  limit: number,
): Promise<DailyClaim> {
  const day = sql.identifier(columns.day);
  const count = sql.identifier(columns.count);
  const { rows } = await db.execute(sql`
    WITH found AS (
      SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL
    ),
    claimed AS (
      UPDATE users SET
        ${count} = CASE WHEN ${day} = ${today} THEN ${count} + 1 ELSE 1 END,
        ${day} = ${today}
      WHERE id IN (SELECT id FROM found)
        AND (${day} IS DISTINCT FROM ${today} OR ${count} < ${limit})
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM found)::int AS found,
           (SELECT count(*) FROM claimed)::int AS claimed
  `);
  const row = rows[0] ?? {};
  if (Number(row.claimed) === 1) return "ok";
  return Number(row.found) === 0 ? "gone" : "limit";
}

/**
 * Gives back `units` taken today, for a call that failed through no fault of the person. It never
 * goes under zero and does nothing if the day has already changed. One statement.
 */
export async function refundDailyUnits(
  db: SqlExecutor,
  userId: string,
  columns: DailyColumns,
  units: number,
): Promise<void> {
  if (units <= 0) return;
  const day = sql.identifier(columns.day);
  const count = sql.identifier(columns.count);
  await db.execute(sql`
    UPDATE users SET ${count} = greatest(${count} - ${units}, 0)
    WHERE id = ${userId} AND ${day} = ${today}
  `);
}
