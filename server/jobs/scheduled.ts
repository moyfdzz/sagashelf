import { getDb, getMediaProviders } from "../runtime-env";
import { refreshStaleMedia } from "./refresh-stale-media";

/**
 * What the Cron Trigger runs (ADR-007: one `scheduled` handler that dispatches small jobs). A
 * failure is logged by name and never thrown, so one job cannot break the next one.
 */
export async function runScheduledJobs(): Promise<void> {
  try {
    const providers = getMediaProviders();
    // Without a provider there is nothing to refresh, and the database stays asleep.
    if (providers.length === 0) return;
    const summary = await refreshStaleMedia({
      db: await getDb(),
      providers,
    });
    console.log(JSON.stringify({ event: "media.refresh_batch", ...summary }));
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "job.failed",
        job: "refresh-stale-media",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}
