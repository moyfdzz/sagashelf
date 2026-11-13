import { sql } from "drizzle-orm";

import type { ProviderCallRow } from "../providers/call-log";
import type { SqlExecutor } from "./clerk-sync";

/**
 * Writes the counts of the calls to the providers that a Worker instance held (SAG-26, ADR-052). It
 * is ONE statement for all the rows, so it costs one subrequest whatever the number of rows, and it
 * ADDS to the row of the day, provider and outcome instead of replacing it: several instances write
 * the same day, and each one adds its own part.
 */
export async function saveProviderCalls(
  db: SqlExecutor,
  rows: readonly ProviderCallRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const payload = JSON.stringify(
    rows.map((row) => ({
      day: row.day,
      provider: row.provider,
      outcome: row.outcome,
      calls: row.calls,
      requests: row.requests,
      latency_ms: row.latencyMs,
    })),
  );
  await db.execute(sql`
    INSERT INTO provider_calls_daily (day, provider, outcome, calls, requests, latency_ms)
    SELECT r.day, r.provider, r.outcome, r.calls, r.requests, r.latency_ms
    FROM jsonb_to_recordset(${payload}::jsonb)
      AS r(day date, provider text, outcome text, calls int, requests int, latency_ms bigint)
    ON CONFLICT (day, provider, outcome) DO UPDATE
    SET calls = provider_calls_daily.calls + EXCLUDED.calls,
        requests = provider_calls_daily.requests + EXCLUDED.requests,
        latency_ms = provider_calls_daily.latency_ms + EXCLUDED.latency_ms
  `);
}
