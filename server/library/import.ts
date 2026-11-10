import type { SqlExecutor } from "../db/clerk-sync";
import {
  lookupTitles,
  writeEntries,
  type EntryToWrite,
  type KnownTitle,
} from "../db/import";
import type { ProfileDb } from "../db/profile";
import { enqueueImport } from "../db/import-queue";
import { titleFetchesPerDay } from "../db/title-budget";
import type { MediaProvider } from "../providers/types";
import {
  normalizeImported,
  type ImportEntry,
  type ParsedImport,
  type Skipped,
} from "./import-file";

/** The database of the Worker is both: plain queries for the writes and `execute` for the provider. */
type Db = ProfileDb & SqlExecutor;

type Classified = {
  /** In the database already, with or without an entry of this person. */
  known: { key: string; entry: ImportEntry; title: KnownTitle }[];
  /** Not in the database: they wait in the queue until the provider is asked for them. */
  toFetch: { key: string; entry: ImportEntry }[];
  skipped: Skipped[];
};

/** Sorts the entries of a file by what an import would do with each. One query. */
async function classify(
  db: Db,
  userId: string,
  parsed: ParsedImport,
  providers: readonly MediaProvider[],
): Promise<Classified> {
  const titles = await lookupTitles(
    db,
    userId,
    parsed.entries.map(({ entry }) => entry.source),
  );
  const asked = new Set(providers.map((provider) => provider.id as string));
  const result: Classified = {
    known: [],
    toFetch: [],
    skipped: [...parsed.skipped],
  };
  for (const { key, entry } of parsed.entries) {
    const title = titles.get(key);
    if (title) {
      result.known.push({ key, entry, title });
    } else if (!asked.has(entry.source.provider)) {
      result.skipped.push({
        title: entry.title,
        reason: "unsupported_provider",
      });
    } else {
      result.toFetch.push({ key, entry });
    }
  }
  return result;
}

export type ImportPreview = {
  /** Titles from a provider that one person may bring in a day: the pace of the queue. */
  perDay: number;
  /** Titles we hold that the person does not have yet: they will be added. */
  add: number;
  /** Titles the person already has: they stay as they are, unless they choose to replace. */
  exists: number;
  /** Titles we do not hold yet: they are asked of the provider in the background, within the daily budget. */
  fetch: number;
  /**
   * Of the titles that would be added (those we hold and those asked of the provider), how many
   * the file marks as public or for friends. They become private unless the person keeps the
   * visibility of the file.
   */
  shared: { public: number; friends: number };
  skipped: Skipped[];
};

/** What an import of this file would do, without writing anything. */
export async function previewImport(
  deps: { db: Db; providers: readonly MediaProvider[] },
  userId: string,
  parsed: ParsedImport,
): Promise<ImportPreview> {
  const sorted = await classify(deps.db, userId, parsed, deps.providers);
  const added = [
    ...sorted.known.filter(({ title }) => !title.hasEntry),
    ...sorted.toFetch,
  ];
  const countOf = (visibility: ImportEntry["visibility"]) =>
    added.filter(({ entry }) => entry.visibility === visibility).length;
  return {
    perDay: titleFetchesPerDay,
    add: sorted.known.filter(({ title }) => !title.hasEntry).length,
    exists: sorted.known.filter(({ title }) => title.hasEntry).length,
    fetch: sorted.toFetch.length,
    shared: { public: countOf("public"), friends: countOf("friends") },
    skipped: sorted.skipped,
  };
}

/**
 * The rows to write for the entries whose title we now hold. Two ids of one title would write the
 * same entry twice: the first one wins and the other is listed as a duplicate. Written once for the
 * upload and for the queue (ADR-033).
 */
export function entriesToWrite(
  ready: readonly { entry: ImportEntry; title: KnownTitle }[],
  keepVisibility: boolean,
): { rows: EntryToWrite[]; duplicates: ImportEntry[] } {
  const seen = new Set<string>();
  const rows: EntryToWrite[] = [];
  const duplicates: ImportEntry[] = [];
  for (const { entry, title } of ready) {
    if (seen.has(title.mediaId)) {
      duplicates.push(entry);
      continue;
    }
    seen.add(title.mediaId);
    rows.push({
      mediaId: title.mediaId,
      ...normalizeImported(entry, title, keepVisibility),
      viewings: entry.viewings,
    });
  }
  return { rows, duplicates };
}

export type ImportResult = {
  added: number;
  replaced: number;
  /** Entries the person already had that were left as they were. */
  kept: number;
  /** Titles that wait in the queue for the provider. */
  queued: number;
  skipped: Skipped[];
};

/**
 * Imports the entries of a file for `userId`, who comes from the session. The titles we already
 * hold are written now, in one statement. The ones only a provider knows are not asked for here
 * (a request has 50 subrequests, a title costs up to 6): they are stored with the choices of the
 * person as a job of the queue, and the scheduled job saves them within the daily budget
 * (`processImportBatch`, ADR-047). Nothing in the file chooses the person or an id of ours, and the
 * visibility of the file counts only with `keepVisibility`, only for new entries.
 */
export async function runImport(
  deps: { db: Db; providers: readonly MediaProvider[] },
  userId: string,
  parsed: ParsedImport,
  options: { replace: boolean; keepVisibility?: boolean; locale: "es" | "en" },
): Promise<ImportResult> {
  const { db, providers } = deps;
  const sorted = await classify(db, userId, parsed, providers);
  const keepVisibility = options.keepVisibility ?? false;
  const skipped = [...sorted.skipped];

  const { rows, duplicates } = entriesToWrite(sorted.known, keepVisibility);
  for (const entry of duplicates) {
    skipped.push({ title: entry.title, reason: "duplicate" });
  }
  const written = await writeEntries(db, userId, rows, options.replace);
  const kept = rows.length - written.added - written.replaced;

  // Every entry that is not in the library has a place, so the list keeps a stable order.
  let next = 0;
  const position = () => next++;
  const pending = sorted.toFetch.map(({ entry }) => ({
    position: position(),
    title: entry.title,
    entry,
  }));
  const left = skipped.map((item) => ({
    position: position(),
    title: item.title,
    reason: item.reason,
  }));
  await enqueueImport(db, userId, {
    replace: options.replace,
    keepVisibility,
    locale: options.locale,
    total: parsed.entries.length + parsed.skipped.length,
    written: { added: written.added, replaced: written.replaced, kept },
    pending,
    skipped: left,
  });
  return {
    added: written.added,
    replaced: written.replaced,
    kept,
    queued: pending.length,
    skipped,
  };
}
