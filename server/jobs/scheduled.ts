import { pruneContactMessages } from "../db/contact-messages";
import { announceNewEpisodes } from "../db/episode-alerts";
import { prunePictureUploads } from "../db/picture-uploads";
import { proposeSagaDrafts } from "../db/saga-drafts";
import {
  getDb,
  getMediaProviders,
  getTvmaze,
  getWebhooksEnabled,
  getWikidata,
} from "../runtime-env";
import { deliverDueEvents } from "./deliver-outbox";
import { refreshNextEpisodes } from "./refresh-next-episodes";
import { enrichWithWikidata } from "./enrich-wikidata";
import { refreshStaleMedia } from "./refresh-stale-media";
import { syncSagas } from "./sync-sagas";

/**
 * The second Cron Trigger (SAG-90, ADR-027): the next episodes. It has an invocation of its own, so
 * it has its own 50 subrequests, which the first one has used. It must be the string of
 * `triggers.crons` in wrangler.jsonc; a test keeps the two equal.
 */
export const tvmazeCron = "30 */6 * * *";

/**
 * The third Cron Trigger (SAG-27, ADR-029): the delivery of webhook events. It is hourly and not every
 * minute: the Neon Free plan pauses the compute after 5 minutes without a query and gives 100
 * compute hours a month (ADR-012, read again 2026-11-02), so a query every minute would keep it
 * awake and use them up. It has an invocation of its own, so its own 50 subrequests. It must be the
 * string of `triggers.crons` in wrangler.jsonc; a test keeps the three equal.
 */
export const outboxCron = "15 * * * *";

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

/**
 * What the second Cron Trigger runs: the records of picture uploads and the messages of the contact
 * page past their time, then the next episode of the series that are due. They go here because this
 * one always runs, and the hourly one does not when the webhooks are off. Two subrequests, on top of
 * the 23 of the episodes: 25 of the 50.
 */
export async function runTvmazeJobs(): Promise<void> {
  try {
    const deleted = await prunePictureUploads(await getDb());
    if (deleted > 0) {
      console.log(JSON.stringify({ event: "picture_uploads.pruned", deleted }));
    }
  } catch (error) {
    logJobFailed("prune-picture-uploads", error);
  }
  try {
    const deleted = await pruneContactMessages(await getDb());
    if (deleted > 0) {
      console.log(
        JSON.stringify({ event: "contact_messages.pruned", deleted }),
      );
    }
  } catch (error) {
    logJobFailed("prune-contact-messages", error);
  }
  try {
    const tvmaze = getTvmaze();
    if (!tvmaze) return;
    const summary = await refreshNextEpisodes({ db: await getDb(), tvmaze });
    console.log(JSON.stringify({ event: "tvmaze.batch", ...summary }));
  } catch (error) {
    logJobFailed("refresh-next-episodes", error);
  }
}

/**
 * What the third Cron Trigger runs: the episodes that came out are announced, and then the webhook
 * events that are due are delivered, the new ones included (ADR-029, ADR-030). With the webhooks
 * switched off it does not even open the database, so a deployment without them costs nothing.
 *
 * The announcement is one statement, so it adds 1 subrequest to the 42 of a full delivery: 43 of the
 * 50. It runs first so an episode that came out is delivered in this same run, and a failure of it
 * is logged and never stops the delivery of what was already waiting.
 */
export async function runOutboxJobs(): Promise<void> {
  try {
    if (!getWebhooksEnabled()) return;
    const db = await getDb();
    try {
      const announced = await announceNewEpisodes(db);
      if (announced.episodes > 0) {
        console.log(
          JSON.stringify({ event: "episodes.announced", ...announced }),
        );
      }
    } catch (error) {
      logJobFailed("announce-episodes", error);
    }
    const summary = await deliverDueEvents({ db });
    console.log(JSON.stringify({ event: "webhooks.batch", ...summary }));
  } catch (error) {
    logJobFailed("deliver-outbox", error);
  }
}

/**
 * The job a Cron Trigger runs, told apart by the string it fired with. Anything that is not one of
 * the other two runs the first one's jobs, as it did before there were more.
 */
export function jobsForCron(cron: string): () => Promise<void> {
  if (cron === tvmazeCron) return runTvmazeJobs;
  if (cron === outboxCron) return runOutboxJobs;
  return runScheduledJobs;
}
