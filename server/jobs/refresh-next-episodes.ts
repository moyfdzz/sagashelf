import type { SqlExecutor } from "../db/clerk-sync";
import {
  findShowsToCheck,
  postponeShows,
  saveNextEpisodes,
  type NextEpisodeToSave,
  type ShowToCheck,
} from "../db/next-episodes";
import { ProviderError } from "../providers/http";
import type { TvmazeClient } from "../providers/tvmaze";
import { nextCheckAt } from "../providers/tvmaze/map";

/**
 * Shows asked about in one run (SAG-90, ADR-027). This job has an invocation of its own (its own
 * Cron Trigger), so it has the 50 subrequests of one: the list, one call to TVmaze per show and the
 * saves come to 20 + 3 at most. TVmaze allows 20 calls in 10 seconds and the client keeps to 2 a
 * second, so a run takes about ten seconds of waiting, which costs no CPU.
 */
export const showsPerRun = 20;

/** A show that could not be answered about waits a day before it is tried again. */
const retryAfterMs = 24 * 60 * 60 * 1000;

const showTimeoutMs = 15_000;

export type NextEpisodeSummary = {
  found: number;
  saved: number;
  withNext: number;
  failed: number;
  /** TVmaze said to slow down (a 429, or the circuit was open): the rest waits for the next run. */
  stopped: boolean;
};

/** A 429 and an open circuit say TVmaze is asking us to stop; asking again could get us banned. */
const asksToStop = (error: unknown) =>
  error instanceof ProviderError &&
  (error.kind === "circuit_open" ||
    error.kind === "rate_limited" ||
    error.status === 429);

/**
 * Asks TVmaze for the next episode of the series that are due (`findShowsToCheck`) and saves the
 * answers in one statement. A show TVmaze does not know is saved as ended and asked about in three
 * months. A show that fails for any other reason waits a day and keeps what we knew; one that is
 * answered with a 429 stops the run, and nothing is changed for the shows not yet asked.
 */
export async function refreshNextEpisodes(
  deps: { db: SqlExecutor; tvmaze: TvmazeClient },
  limit: number = showsPerRun,
  now: () => Date = () => new Date(),
): Promise<NextEpisodeSummary> {
  const summary: NextEpisodeSummary = {
    found: 0,
    saved: 0,
    withNext: 0,
    failed: 0,
    stopped: false,
  };
  const shows = await findShowsToCheck(deps.db, limit);
  summary.found = shows.length;

  const answers: NextEpisodeToSave[] = [];
  const failed: ShowToCheck[] = [];
  for (const show of shows) {
    try {
      const answer = await deps.tvmaze.getShow(show.tvmazeId, {
        signal: AbortSignal.timeout(showTimeoutMs),
      });
      answers.push({
        mediaId: show.mediaId,
        tvmazeId: show.tvmazeId,
        showStatus: answer?.status ?? null,
        airDate: answer?.next?.airDate ?? null,
        airStamp: answer?.next?.airStamp ?? null,
        season: answer?.next?.season ?? null,
        number: answer?.next?.number ?? null,
        episodeName: answer?.next?.name ?? null,
        nextCheckAt: nextCheckAt(now(), answer),
      });
    } catch (error) {
      if (asksToStop(error)) {
        summary.stopped = true;
        break;
      }
      failed.push(show);
    }
  }

  await saveNextEpisodes(deps.db, answers);
  await postponeShows(
    deps.db,
    failed,
    new Date(now().getTime() + retryAfterMs),
  );
  summary.saved = answers.length;
  summary.withNext = answers.filter((answer) => answer.airDate).length;
  summary.failed = failed.length;
  return summary;
}
