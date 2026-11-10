import type { SqlExecutor } from "../db/clerk-sync";
import { lookupTitles, writeEntries, type KnownTitle } from "../db/import";
import {
  claimImportRows,
  finishImportRows,
  pauseUntilTomorrow,
  type ClaimedRow,
  type QueueSkipReason,
} from "../db/import-queue";
import type { ProfileDb } from "../db/profile";
import { claimTitleFetch, refundTitleFetches } from "../db/title-budget";
import { entriesToWrite } from "../library/import";
import {
  importEntrySchema,
  keyOf,
  type ImportEntry,
} from "../library/import-file";
import { importMedia } from "../media/import";
import type { MediaProvider } from "../providers/types";

type Db = ProfileDb & SqlExecutor;

export type ImportBatchSummary = {
  taken: number;
  added: number;
  replaced: number;
  kept: number;
  skipped: number;
  retried: number;
  /** People whose budget of the day ran out in this run. */
  dayOver: number;
};

/**
 * The scheduled job of the import queue (SAG-241, ADR-047). It takes a few titles that wait (at most
 * 5 from 2 people), saves each one through the provider inside the person's budget of new titles
 * (the same 300 a day as `/media/open`, ADR-035), and writes the entries to the library. It has a
 * Cron Trigger of its own and uses at most 45 of its 50 subrequests: the claim (1), the finish (1),
 * the budget (5), the providers (5 titles of up to 6 each) and for each of 2 people the lookups,
 * the write and a refund (4 each), plus the pause of the day (1).
 *
 * A title we hold already (another person saved it meanwhile) costs no budget. A title the provider
 * does not know is listed as not found. When the provider does not answer, the unit is given back
 * and the title waits an hour; after 3 tries it is listed as failed, so nothing waits forever. When
 * the day's budget is spent, the rest of that person waits until the next UTC day.
 */
export async function processImportBatch(deps: {
  db: Db;
  providers: readonly MediaProvider[];
}): Promise<ImportBatchSummary> {
  const { db, providers } = deps;
  const summary: ImportBatchSummary = {
    taken: 0,
    added: 0,
    replaced: 0,
    kept: 0,
    skipped: 0,
    retried: 0,
    dayOver: 0,
  };
  const claimed = await claimImportRows(db);
  summary.taken = claimed.length;
  if (claimed.length === 0) return summary;

  const done: string[] = [];
  const skipped: { id: string; reason: QueueSkipReason }[] = [];
  const retry: string[] = [];
  const dayOver: string[] = [];
  const counts: {
    jobId: string;
    added: number;
    replaced: number;
    kept: number;
  }[] = [];

  const byPerson = new Map<string, ClaimedRow[]>();
  for (const row of claimed) {
    byPerson.set(row.userId, [...(byPerson.get(row.userId) ?? []), row]);
  }

  for (const [userId, rows] of byPerson) {
    // The rows of one person all come from one job, so they share its choices.
    const first = rows[0];
    if (!first) continue;
    const entries: { row: ClaimedRow; entry: ImportEntry }[] = [];
    for (const row of rows) {
      // The entry was checked when it was stored; this is a guard against a row edited by hand.
      const parsed = importEntrySchema.safeParse(row.entry);
      if (parsed.success) entries.push({ row, entry: parsed.data });
      else skipped.push({ id: row.id, reason: "invalid" });
    }

    const known = await lookupTitles(
      db,
      userId,
      entries.map(({ entry }) => entry.source),
    );
    const ready: { row: ClaimedRow; entry: ImportEntry; title: KnownTitle }[] =
      [];
    const toFetch: { row: ClaimedRow; entry: ImportEntry }[] = [];
    let spent = false;
    for (const item of entries) {
      const title = known.get(keyOf(item.entry.source));
      if (title) {
        ready.push({ ...item, title });
        continue;
      }
      if (!providers.some((p) => p.id === item.entry.source.provider)) {
        skipped.push({ id: item.row.id, reason: "unsupported_provider" });
        continue;
      }
      if (spent) continue;
      const claim = await claimTitleFetch(db, userId);
      if (claim === "ok") {
        toFetch.push(item);
      } else {
        // The day is over (or the account is gone): this title and the rest of the person's wait.
        spent = true;
        if (claim === "limit") dayOver.push(userId);
      }
    }

    let refunded = 0;
    if (toFetch.length > 0) {
      const outcomes = await Promise.allSettled(
        toFetch.map(({ row, entry }) =>
          importMedia(
            { db, providers },
            entry.source.provider,
            entry.source.id,
            row.locale,
          ),
        ),
      );
      const saved: typeof toFetch = [];
      toFetch.forEach((item, index) => {
        const outcome = outcomes[index];
        if (outcome?.status === "fulfilled" && outcome.value) saved.push(item);
        else if (outcome?.status === "fulfilled") {
          skipped.push({ id: item.row.id, reason: "not_found" });
        } else {
          // The provider did not answer: it used no quota, so the unit goes back.
          refunded++;
          retry.push(item.row.id);
        }
      });
      if (saved.length > 0) {
        const found = await lookupTitles(
          db,
          userId,
          saved.map(({ entry }) => entry.source),
        );
        for (const item of saved) {
          const title = found.get(keyOf(item.entry.source));
          if (title) ready.push({ ...item, title });
          else retry.push(item.row.id);
        }
      }
    }
    if (refunded > 0) await refundTitleFetches(db, userId, refunded);

    const { rows: toWrite, duplicates } = entriesToWrite(
      ready,
      first.keepVisibility,
    );
    const duplicated = new Set(duplicates);
    for (const item of ready) {
      if (duplicated.has(item.entry)) {
        skipped.push({ id: item.row.id, reason: "duplicate" });
      } else {
        done.push(item.row.id);
      }
    }
    const written = await writeEntries(db, userId, toWrite, first.replace);
    const kept = toWrite.length - written.added - written.replaced;
    counts.push({
      jobId: first.jobId,
      added: written.added,
      replaced: written.replaced,
      kept,
    });
    summary.added += written.added;
    summary.replaced += written.replaced;
    summary.kept += kept;
  }

  await finishImportRows(db, { done, skipped, retry, counts });
  await pauseUntilTomorrow(db, dayOver);
  summary.skipped = skipped.length;
  summary.retried = retry.length;
  summary.dayOver = dayOver.length;
  return summary;
}
