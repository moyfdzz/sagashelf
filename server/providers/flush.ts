import { saveProviderCalls } from "../db/provider-calls";
import { getDb } from "../runtime-env";
import { hasProviderCalls, takeProviderCalls } from "./call-log";

/**
 * Writes the calls this Worker instance has counted (SAG-26, ADR-052). The Worker runs it after the
 * response is sent (`waitUntil`) and after a Cron Trigger, so it adds no time to a request. With
 * nothing counted it does nothing, not even open the database, so the compute of Neon is never
 * woken only for this: an instance that called a provider was already serving a request that read
 * the database, or running a job.
 *
 * It never throws. A failure is logged by name and the counts of that moment are lost: they are
 * only a guide, and keeping them would grow the memory of the instance. One statement is one
 * subrequest, which the budgets of the Cron Triggers leave room for (ADR-001).
 */
export async function flushProviderCalls(): Promise<void> {
  if (!hasProviderCalls()) return;
  const rows = takeProviderCalls();
  try {
    await saveProviderCalls(await getDb(), rows);
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "provider_calls.flush_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}
