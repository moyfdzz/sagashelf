import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * Titles one person may make us fetch from a provider in a UTC day (SAG-239, ADR-035). It protects
 * the quota of the providers and the size of the database. The per-minute limit stays in the
 * Workers binding; this one is counted by person only, so a new address gives no new budget.
 */
export const titleFetchesPerDay = 300;

export type TitleClaim = "ok" | "limit" | "gone";

/**
 * Takes one of the fetches the person has today, before a provider is asked. One statement checks
 * the count and adds to it, so requests sent together cannot pass the limit. A fetch that fails
 * afterwards is not given back: the call to the provider was already spent.
 */
export async function claimTitleFetch(
  db: SqlExecutor,
  userId: string,
): Promise<TitleClaim> {
  const today = sql`(now() AT TIME ZONE 'utc')::date`;
  const { rows } = await db.execute(sql`
    WITH found AS (
      SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL
    ),
    claimed AS (
      UPDATE users SET
        title_fetches_count = CASE
          WHEN title_fetches_day = ${today} THEN title_fetches_count + 1
          ELSE 1
        END,
        title_fetches_day = ${today}
      WHERE id IN (SELECT id FROM found)
        AND (
          title_fetches_day IS DISTINCT FROM ${today}
          OR title_fetches_count < ${titleFetchesPerDay}
        )
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM found)::int AS found,
           (SELECT count(*) FROM claimed)::int AS claimed
  `);
  const row = rows[0] ?? {};
  if (Number(row.claimed) === 1) return "ok";
  return Number(row.found) === 0 ? "gone" : "limit";
}
