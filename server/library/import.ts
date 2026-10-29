import type { SqlExecutor } from "../db/clerk-sync";
import {
  lookupTitles,
  writeEntries,
  type EntryToWrite,
  type KnownTitle,
} from "../db/import";
import type { ProfileDb } from "../db/profile";
import { importMedia } from "../media/import";
import type { Locale, MediaProvider } from "../providers/types";
import {
  maxNewTitles,
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
  /** Not in the database: the provider is asked for them, up to `maxNewTitles`. */
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
    } else if (result.toFetch.length < maxNewTitles) {
      result.toFetch.push({ key, entry });
    } else {
      result.skipped.push({ title: entry.title, reason: "pending" });
    }
  }
  return result;
}

export type ImportPreview = {
  /** Titles we hold that the person does not have yet: they will be added. */
  add: number;
  /** Titles the person already has: they stay as they are, unless they choose to replace. */
  exists: number;
  /** Titles we do not hold yet, asked of the provider when the person confirms. */
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
    add: sorted.known.filter(({ title }) => !title.hasEntry).length,
    exists: sorted.known.filter(({ title }) => title.hasEntry).length,
    fetch: sorted.toFetch.length,
    shared: { public: countOf("public"), friends: countOf("friends") },
    skipped: sorted.skipped,
  };
}

export type ImportResult = {
  added: number;
  replaced: number;
  /** Entries the person already had that were left as they were. */
  kept: number;
  skipped: Skipped[];
};

/**
 * Imports the entries of a file for `userId`, who comes from the session. A title we do not hold
 * is saved only through the provider (never from the data of the file), up to `maxNewTitles`; the
 * rest are listed as pending and a second import brings them. The entries are written in one
 * statement. Nothing in the file chooses the person or an id of ours, and the visibility of the
 * file counts only with `keepVisibility`, only for new entries.
 */
export async function runImport(
  deps: { db: Db; providers: readonly MediaProvider[] },
  userId: string,
  parsed: ParsedImport,
  options: { replace: boolean; keepVisibility?: boolean; locale: Locale },
): Promise<ImportResult> {
  const { db, providers } = deps;
  const sorted = await classify(db, userId, parsed, providers);
  const skipped = [...sorted.skipped];
  const ready = [...sorted.known];

  if (sorted.toFetch.length > 0) {
    const outcomes = await Promise.allSettled(
      sorted.toFetch.map(({ entry }) =>
        importMedia(
          { db, providers },
          entry.source.provider,
          entry.source.id,
          options.locale,
        ),
      ),
    );
    const saved = sorted.toFetch.filter(
      (_, index) =>
        outcomes[index]?.status === "fulfilled" && outcomes[index].value,
    );
    sorted.toFetch.forEach(({ entry }, index) => {
      const outcome = outcomes[index];
      if (outcome?.status === "fulfilled" && outcome.value) return;
      // The provider does not know the id, or did not answer: another import can try again.
      skipped.push({
        title: entry.title,
        reason: outcome?.status === "fulfilled" ? "not_found" : "pending",
      });
    });
    if (saved.length > 0) {
      const found = await lookupTitles(
        db,
        userId,
        saved.map(({ entry }) => entry.source),
      );
      for (const { key, entry } of saved) {
        const title = found.get(key);
        if (title) ready.push({ key, entry, title });
      }
    }
  }

  // Two ids of one title would write the same entry twice: the first one wins.
  const seen = new Set<string>();
  const rows: EntryToWrite[] = [];
  for (const { entry, title } of ready) {
    if (seen.has(title.mediaId)) {
      skipped.push({ title: entry.title, reason: "duplicate" });
      continue;
    }
    seen.add(title.mediaId);
    rows.push({
      mediaId: title.mediaId,
      ...normalizeImported(entry, title, options.keepVisibility ?? false),
      viewings: entry.viewings,
    });
  }

  const written = await writeEntries(db, userId, rows, options.replace);
  return {
    added: written.added,
    replaced: written.replaced,
    kept: rows.length - written.added - written.replaced,
    skipped,
  };
}
