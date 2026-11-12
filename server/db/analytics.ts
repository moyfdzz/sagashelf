import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * The storage of the cookieless analytics (SAG-24, ADR-009, ADR-050). Every function is one
 * statement. Nothing here knows the address of a visitor: the route hashes it before it gets here.
 */

/**
 * The salt of `day` (`YYYY-MM-DD`, UTC). The first call of the day stores `candidate`, a random
 * value the caller made, and every call after that returns the stored one. It also deletes the salts
 * older than yesterday, so a hash of an earlier day cannot be recomputed. Returns null when another
 * call stored the salt at the same moment and this statement could not see it yet: ask again.
 */
export async function getDailySalt(
  db: SqlExecutor,
  day: string,
  candidate: string,
): Promise<string | null> {
  const { rows } = await db.execute(sql`
    WITH fresh AS (
      INSERT INTO analytics_salts (day, salt)
      VALUES (${day}::date, ${candidate})
      ON CONFLICT (day) DO NOTHING
      RETURNING salt
    ),
    pruned AS (
      DELETE FROM analytics_salts WHERE day < ${day}::date - 1 RETURNING 1
    )
    SELECT salt FROM fresh
    UNION ALL
    SELECT salt FROM analytics_salts WHERE day = ${day}::date
    LIMIT 1
  `);
  const row = rows[0] as { salt?: string } | undefined;
  return row?.salt ?? null;
}

export type NewAnalyticsEvent = {
  kind: string;
  path: string;
  visitor: string;
  engagedMs: number | null;
  searchType: string | null;
  referrerClass: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  country: string | null;
  region: string | null;
  device: string | null;
};

/** Stores one raw event. */
export async function insertAnalyticsEvent(
  db: SqlExecutor,
  event: NewAnalyticsEvent,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO analytics_events (
      kind, path, visitor, engaged_ms, search_type, referrer_class, referrer_host,
      utm_source, utm_medium, utm_campaign, country, region, device
    ) VALUES (
      ${event.kind}, ${event.path}, ${event.visitor}, ${event.engagedMs}, ${event.searchType},
      ${event.referrerClass}, ${event.referrerHost}, ${event.utmSource}, ${event.utmMedium},
      ${event.utmCampaign}, ${event.country}, ${event.region}, ${event.device}
    )
  `);
}
