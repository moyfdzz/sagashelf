import type { SqlExecutor } from "./db/clerk-sync";
import { claimTitleFetch, refundTitleFetches } from "./db/title-budget";
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

/** Why a call to a provider may not go on: a burst (try in a minute), the day, or a gone account. */
export type OpenSpend =
  { status: "ok" } | { status: "burst" | "daily" | "gone"; response: Response };

/**
 * Spends one unit of the per-person budget of new titles (ADR-035), two limits in this order:
 *
 * 1. The Workers binding, per person and per address (10 a minute): cheap, and it stops a burst
 *    before the database is asked. It counts per Cloudflare location, so it is not exact.
 * 2. The counter in the database, per person only (300 a UTC day): it holds whatever address is
 *    used. One statement per call (a subrequest on the Worker).
 *
 * The status says which one refused, so the import can tell the person to wait a minute or a day.
 */
export async function trySpendOpenUnit(
  request: Request,
  db: SqlExecutor,
  userId: string,
): Promise<OpenSpend> {
  const burst = await rateLimit(
    getOpenLimiter(),
    request,
    `media-open:${userId}`,
  );
  if (burst) return { status: "burst", response: burst };

  const claim = await claimTitleFetch(db, userId);
  if (claim === "ok") return { status: "ok" };
  if (claim === "gone") {
    return {
      status: "gone",
      response: Response.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return {
    status: "daily",
    response: Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(secondsToUtcMidnight(new Date())) },
      },
    ),
  };
}

/**
 * The same, for a route that answers with the refusal: a 429 (or 403 for an erased account) when
 * the call to the provider must not go on, or null when it may. Every route that saves a title from
 * a provider calls this, so the two limits are written once.
 */
export async function spendOpenUnit(
  request: Request,
  db: SqlExecutor,
  userId: string,
): Promise<Response | null> {
  const spend = await trySpendOpenUnit(request, db, userId);
  return spend.status === "ok" ? null : spend.response;
}

/**
 * Gives back units for calls the provider did not answer (it was down or slow): that is not the
 * person's doing and it added no title. A call the provider did answer, even with "not found",
 * stays spent, since it used the quota of the provider.
 */
export const refundOpenUnits = (
  db: SqlExecutor,
  userId: string,
  units: number,
) => refundTitleFetches(db, userId, units);
