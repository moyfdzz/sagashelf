import type { SqlExecutor } from "../db/clerk-sync";
import {
  findMediaToRefresh,
  markRefreshAttempt,
  saveMedia,
  saveParts,
} from "../db/media-store";
import type { Locale, MediaProvider } from "../providers/types";

/**
 * Titles asked about in one run. Workers Free allows 50 subrequests per invocation (ADR-001) and
 * a title costs at most 2 provider calls for the details, 2 saves, 2 or 3 for the seasons, 1 to
 * save them and 1 to note a failure: about 8, so 5 titles and the list query stay near 41.
 */
export const refreshBatchSize = 5;

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
): Promise<RefreshSummary> {
  const summary: RefreshSummary = { found: 0, refreshed: 0, failed: 0 };
  // A deployment with no provider secret has nothing to ask, so it does not wake the database.
  if (deps.providers.length === 0) return summary;

  const rows = await findMediaToRefresh(deps.db, limit);
  summary.found = rows.length;

  for (const row of rows) {
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
        // The provider no longer knows it. It is tried again after a day, not on every run.
        await markRefreshAttempt(deps.db, row.mediaId);
        logFailure("media.refresh_missing", row.provider);
        summary.failed += 1;
        continue;
      }

      let id = row.mediaId;
      for (const [index, item] of media.entries()) {
        if (item) id = await saveMedia(deps.db, item, locales[index]);
      }
      if (source.capabilities.parts) {
        try {
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
      await markRefreshAttempt(deps.db, row.mediaId).catch(() => undefined);
    }
  }
  return summary;
}
