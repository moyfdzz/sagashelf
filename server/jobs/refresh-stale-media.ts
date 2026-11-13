import type { SqlExecutor } from "../db/clerk-sync";
import {
  findMediaToRefresh,
  markRefreshAttempt,
  removeProviderData,
  saveMedia,
  saveParts,
} from "../db/media-store";
import { countOutgoingCalls } from "../providers/http";
import type { Locale, MediaProvider } from "../providers/types";

/**
 * Titles asked about in one run. Workers Free allows 50 subrequests per invocation (ADR-001) and
 * a title costs at most 2 provider calls for the details, 2 saves, 2 or 3 for the seasons, 1 to
 * save them and 1 to note a failure: about 8, so 5 titles and the list query stay near 41.
 */
export const refreshBatchSize = 5;

/**
 * The share of the 50 subrequests of the first Cron Trigger that this job may spend: the rest is for
 * the Wikidata job (4), the sagas sync (4), the drafts (1) that run after it and the write of the count of the provider calls (1, SAG-26, ADR-052). A provider call
 * that is retried spends one more, so the count is read from the clients, not guessed (SAG-182).
 * Before each title the job asks whether one more title (`titleCost`: about 7 with no retry, 12
 * allowing for some) still fits; if not it stops and the title waits for the next run. The check
 * is made before a title, not inside it, so a title whose calls are all retried can still pass the
 * budget a little. Priority of the first trigger: this refresh, then
 * Wikidata, then the sagas sync, then the drafts.
 */
export const refreshSubrequestBudget = 40;
const titleCost = 12;

/** The two languages of the app. `en` goes first so the title column ends in Spanish, the default. */
const locales: readonly Locale[] = ["en", "es"];

const titleTimeoutMs = 20_000;

export type RefreshSummary = {
  found: number;
  refreshed: number;
  failed: number;
};

const logFailure = (event: string, provider: string, error?: unknown) =>
  console.log(
    JSON.stringify({
      event,
      provider,
      ...(error === undefined
        ? {}
        : { error: error instanceof Error ? error.name : "unknown" }),
    }),
  );

/**
 * Refreshes the titles that are about to pass the 6 months TMDB lets us keep (ADR-016), and
 * fills the language a title was never asked for. Each title is asked for in both languages
 * and saved only when both answers arrive, so a failure leaves it as it was. `saveMedia` keeps
 * what it holds when the provider sends nothing (a null original title never erases one). One
 * title that fails does not stop the rest.
 */
export async function refreshStaleMedia(
  deps: { db: SqlExecutor; providers: readonly MediaProvider[] },
  limit: number = refreshBatchSize,
  budget: number = refreshSubrequestBudget,
): Promise<RefreshSummary> {
  const summary: RefreshSummary = { found: 0, refreshed: 0, failed: 0 };
  // A deployment with no provider secret has nothing to ask, so it does not wake the database.
  if (deps.providers.length === 0) return summary;

  const rows = await findMediaToRefresh(
    deps.db,
    limit,
    deps.providers.map((provider) => provider.id),
  );
  summary.found = rows.length;

  const startedAt = countOutgoingCalls();
  // The list query, then the statements this loop runs.
  let statements = 1;
  const spent = () => countOutgoingCalls() - startedAt + statements;

  for (const row of rows) {
    if (spent() + titleCost > budget) {
      console.log(
        JSON.stringify({ event: "media.refresh_budget", spent: spent() }),
      );
      break;
    }
    const source = deps.providers.find(
      (candidate) => candidate.id === row.provider,
    );
    if (!source) continue;

    try {
      const signal = AbortSignal.timeout(titleTimeoutMs);
      const media = await Promise.all(
        locales.map((locale) =>
          source.getById(row.externalId, { locale, signal }),
        ),
      );
      if (media.some((item) => item === null)) {
        statements += 1;
        // Only when TMDB says it does not know the title in either language: a miss in one language
        // is not proof that it is gone.
        const gone = media.every((item) => item === null);
        if (row.provider === "tmdb" && row.stale && gone) {
          // TMDB no longer has it and the 6 months it allows are about to end: what it sent is
          // removed and the row stays for the libraries that hold it (SAG-180, ADR-016).
          await removeProviderData(deps.db, row.mediaId);
          logFailure("media.refresh_removed", row.provider);
        } else {
          // The provider no longer knows it. It is tried again after a day, not on every run.
          await markRefreshAttempt(deps.db, row.mediaId);
          logFailure("media.refresh_missing", row.provider);
        }
        summary.failed += 1;
        continue;
      }

      let id = row.mediaId;
      for (const [index, item] of media.entries()) {
        if (!item) continue;
        statements += 1;
        // Only the last language marks the title as fresh: a run that stops between the two leaves
        // it due again, not half saved and looking fresh.
        id = await saveMedia(
          deps.db,
          item,
          locales[index],
          index === media.length - 1,
        );
      }
      if (source.capabilities.parts) {
        try {
          statements += 1;
          await saveParts(
            deps.db,
            id,
            await source.getParts(row.externalId, { signal }),
          );
        } catch {
          // The title is useful without its seasons; the next refresh tries again.
        }
      }
      summary.refreshed += 1;
    } catch (error) {
      logFailure("media.refresh_failed", row.provider, error);
      summary.failed += 1;
      statements += 1;
      await markRefreshAttempt(deps.db, row.mediaId).catch(() => undefined);
    }
  }
  return summary;
}
