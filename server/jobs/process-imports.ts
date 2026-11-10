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
  matchEntrySchema,
  type ImportEntry,
  type MatchEntry,
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
 * Cron Trigger of its own and uses at most 46 of its 50 subrequests: the claim (1), the finish (1),
 * the budget (5), the providers (5 places of up to 6 each) and for each of 2 people the lookups,
 * the write and a refund (4 each), plus the pause of the day (1).
 *
 * An entry that has a name and a year but no id (SAG-243) is looked for first (`matchByYear`, up to
 * 8 requests) and then goes on like any other. It takes 3 of the 5 places, and 8 + 6 requests fit
 * in 3 places of 6. One that fits no series (or two) is listed as having no catalog id; a provider
 * that does not answer is a try, like for a title.
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

  // Units of the budget taken for titles whose provider call has not been made yet. If the run of a
  // person fails before it, they go back: the call was never made, so it used no quota.
  const unfetched = new Map<string, number>();

  const processPerson = async (userId: string, rows: ClaimedRow[]) => {
    // The rows of one person all come from one job, so they share its choices.
    const first = rows[0];
    if (!first) return;
    const entries: { row: ClaimedRow; entry: ImportEntry }[] = [];
    const toMatch: { row: ClaimedRow; entry: MatchEntry }[] = [];
    for (const row of rows) {
      // The entry was checked when it was stored; this is a guard against a row edited by hand.
      const parsed = importEntrySchema.safeParse(row.entry);
      if (parsed.success) {
        entries.push({ row, entry: parsed.data });
        continue;
      }
      const wanted = matchEntrySchema.safeParse(row.entry);
      if (wanted.success) toMatch.push({ row, entry: wanted.data });
      else skipped.push({ id: row.id, reason: "invalid" });
    }

    const matcher = providers.find(
      (provider) => provider.id === "tmdb" && provider.matchByYear,
    );
    if (toMatch.length > 0 && !matcher) {
      for (const { row } of toMatch) {
        skipped.push({ id: row.id, reason: "no_source" });
      }
    } else if (matcher?.matchByYear) {
      const answers = await Promise.allSettled(
        toMatch.map(({ row, entry }) =>
          matcher.matchByYear?.(entry.match, { locale: row.locale }),
        ),
      );
      toMatch.forEach(({ row, entry }, index) => {
        const answer = answers[index];
        if (answer?.status === "rejected") {
          retry.push(row.id);
        } else if (answer?.status === "fulfilled" && answer.value) {
          // The name and year stay on the object, unread: only the source matters from here on.
          entries.push({
            row,
            entry: { ...entry, source: { provider: "tmdb", id: answer.value } },
          });
        } else {
          skipped.push({ id: row.id, reason: "no_source" });
        }
      });
    }

    // Two rows can name one title once the lookups are done (two seasons of a series): the first
    // goes on and the rest are duplicates, so the title is not fetched and charged twice.
    const named = new Set<string>();
    for (const item of entries.splice(0)) {
      const key = keyOf(item.entry.source);
      if (named.has(key)) {
        skipped.push({ id: item.row.id, reason: "duplicate" });
      } else {
        named.add(key);
        entries.push(item);
      }
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
        unfetched.set(userId, (unfetched.get(userId) ?? 0) + 1);
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
      // Every call was made now, so every unit taken is spent, or refunded just below.
      unfetched.delete(userId);
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
          // The provider answered and saved it, but not as the id of the file: asking again would
          // spend the budget again for the same answer.
          else skipped.push({ id: item.row.id, reason: "not_found" });
        }
      }
    }
    if (refunded > 0) await refundTitleFetches(db, userId, refunded);

    const { rows: toWrite, duplicates } = entriesToWrite(
      ready,
      first.keepVisibility,
    );
    const written = await writeEntries(db, userId, toWrite, first.replace);
    // Only after the write: a row whose write failed must stay and count a try.
    const duplicated = new Set(duplicates);
    for (const item of ready) {
      if (duplicated.has(item.entry)) {
        skipped.push({ id: item.row.id, reason: "duplicate" });
      } else {
        done.push(item.row.id);
      }
    }
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
  };

  for (const [userId, rows] of byPerson) {
    try {
      await processPerson(userId, rows);
    } catch (error) {
      // One person's failure must not hold back the others, and the rows must count a try, or a
      // row that always throws would be taken again for ever.
      console.log(
        JSON.stringify({
          event: "imports.person_failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      const leaked = unfetched.get(userId) ?? 0;
      if (leaked > 0) {
        try {
          await refundTitleFetches(db, userId, leaked);
        } catch {
          // The unit stays spent; the rows are tried again anyway.
        }
      }
      const settled = new Set([...done, ...skipped.map((item) => item.id)]);
      for (const row of rows) {
        if (!settled.has(row.id) && !retry.includes(row.id)) retry.push(row.id);
      }
    }
  }

  await finishImportRows(db, { done, skipped, retry, counts });
  await pauseUntilTomorrow(db, dayOver);
  summary.skipped = skipped.length;
  summary.retried = retry.length;
  summary.dayOver = dayOver.length;
  return summary;
}
