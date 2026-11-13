import { saveProviderCalls } from "../db/provider-calls";
import { clearDatabaseUsed, getDb } from "../runtime-env";
import {
  hasProviderCalls,
  restoreProviderCalls,
  takeProviderCalls,
} from "./call-log";

/**
 * Writes the calls this Worker instance has counted (SAG-26, ADR-052). The Worker runs it after the
 * response is sent (`waitUntil`) when the request used the database, and after a Cron Trigger, so it
 * adds no time to a request and is never the query that wakes the paused compute of Neon
 * (ADR-012). With nothing counted it does nothing, not even open the database.
 *
 * It never throws. A failure is logged by name and the counts go back to the memory of the
 * instance, to be written with the next flush (their number is bounded: days x providers x outcomes).
 * One statement is one subrequest, which the budgets of the Cron Triggers leave room for (ADR-001).
 */
export async function flushProviderCalls(): Promise<void> {
  if (!hasProviderCalls()) {
    clearDatabaseUsed();
    return;
  }
  const rows = takeProviderCalls();
  try {
    await saveProviderCalls(await getDb(), rows);
  } catch (error) {
    restoreProviderCalls(rows);
    console.log(
      JSON.stringify({
        event: "provider_calls.flush_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  } finally {
    // The write itself opened the database: that must not count as a request that used it.
    clearDatabaseUsed();
  }
}
