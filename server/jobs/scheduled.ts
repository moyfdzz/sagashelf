import { proposeSagaDrafts } from "../db/saga-drafts";
import { getDb, getMediaProviders, getWikidata } from "../runtime-env";
import { enrichWithWikidata } from "./enrich-wikidata";
import { refreshStaleMedia } from "./refresh-stale-media";
import { syncSagas } from "./sync-sagas";

const logJobFailed = (job: string, error: unknown) =>
  console.log(
    JSON.stringify({
      event: "job.failed",
      job,
      error: error instanceof Error ? error.name : "unknown",
    }),
  );

/**
 * What the Cron Trigger runs (ADR-007: one `scheduled` handler that dispatches small jobs). A
 * failure is logged by name and never thrown, so one job cannot break the next one.
 */
export async function runScheduledJobs(): Promise<void> {
  try {
    const providers = getMediaProviders();
    // Without a provider there is nothing to refresh, and the database stays asleep.
    if (providers.length > 0) {
      const summary = await refreshStaleMedia({
        db: await getDb(),
        providers,
      });
      console.log(JSON.stringify({ event: "media.refresh_batch", ...summary }));
    }
  } catch (error) {
    logJobFailed("refresh-stale-media", error);
  }

  // After the refresh, which fills the ids this job looks titles up by (SAG-16, ADR-025).
  try {
    const wikidata = getWikidata();
    if (wikidata) {
      const summary = await enrichWithWikidata({ db: await getDb(), wikidata });
      console.log(JSON.stringify({ event: "wikidata.batch", ...summary }));
    }
  } catch (error) {
    logJobFailed("enrich-wikidata", error);
  }

  // The curated sagas (SAG-25, ADR-026). With nothing to do it costs one subrequest.
  let sagasIdle = false;
  try {
    const wikidata = getWikidata();
    if (wikidata) {
      const summary = await syncSagas({ db: await getDb(), wikidata });
      console.log(JSON.stringify({ event: "sagas.sync", ...summary }));
      sagasIdle = summary.sagas === 0 && summary.items === 0;
    }
  } catch (error) {
    logJobFailed("sync-sagas", error);
  }

  // Drafts for an administrator to review (SAG-92). They cost one more subrequest, so they wait
  // for a run in which the sync had nothing to do: the first run of the sync costs four, and with
  // the other jobs the 50 of a scheduled invocation would be passed.
  if (sagasIdle) {
    try {
      const created = await proposeSagaDrafts(await getDb());
      if (created > 0) {
        console.log(JSON.stringify({ event: "sagas.drafts", created }));
      }
    } catch (error) {
      logJobFailed("propose-saga-drafts", error);
    }
  }
}
