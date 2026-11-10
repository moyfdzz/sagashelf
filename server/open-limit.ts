import type { SqlExecutor } from "./db/clerk-sync";
import { claimTitleFetch } from "./db/title-budget";
import { rateLimit } from "./rate-limit";
import { getOpenLimiter } from "./runtime-env";

/** Seconds until the next UTC midnight, when the daily budget starts again. */
function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * Spends one unit of the per-person budget of new titles (ADR-035). Every route that saves a
 * title from a provider calls this, so the two limits are written once. Returns a response (429,
 * or 403 if the account is gone) when the call to the provider must not go on, or null when it may.
 *
 * 1. The Workers binding, per person and per address (10 a minute): cheap, and it stops a burst
 *    before the database is asked. It counts per Cloudflare location, so it is not exact.
 * 2. The counter in the database, per person only (a day): it holds whatever address is used.
 *    One statement per call (a subrequest on the Worker).
 */
export async function spendOpenUnit(
  request: Request,
  db: SqlExecutor,
  userId: string,
): Promise<Response | null> {
  const burst = await rateLimit(
    getOpenLimiter(),
    request,
    `media-open:${userId}`,
  );
  if (burst) return burst;

  const claim = await claimTitleFetch(db, userId);
  if (claim === "ok") return null;
  if (claim === "gone")
    return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: { "Retry-After": String(secondsToUtcMidnight(new Date())) },
    },
  );
}
