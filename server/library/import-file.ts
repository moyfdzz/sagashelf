import { z } from "zod";

import {
  libraryStatuses,
  notesMaxLength,
  progressMax,
  progressUnits,
  progressUnitsFor,
  viewingNotesMaxLength,
} from "./schema";
import type { LibraryStatus } from "./schema";
import { maxViewings } from "../db/viewings";
import {
  convertSimklBackup,
  isSimklBackup,
  simklEntryCount,
} from "./import-simkl";

/** The most bytes of a file to import. A library of 5,000 titles with notes is under it. */
export const maxImportBytes = 5 * 1024 * 1024;
/**
 * The most entries one file may hold. The titles that only a provider knows are not asked for in
 * the request that carries the file: they wait in a queue (SAG-241, ADR-047).
 */
export const maxImportEntries = 5000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  });

// The text counts characters, as the database does: an emoji is one.
const shortText = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .refine((value) => [...value].length <= max)
    .transform((value) => (value === "" ? null : value));

const viewingSchema = z.object({
  startedOn: isoDate.nullable().catch(null),
  finishedOn: isoDate.nullable().catch(null),
  notes: shortText(viewingNotesMaxLength).nullable().catch(null),
});

/** One library entry of the file. Only these fields are read: anything else is left alone. */
export const importEntrySchema = z.object({
  title: z
    .string()
    .max(300)
    .nullable()
    .catch(null)
    .transform((value) => value ?? ""),
  // The catalog id of the title in its source. Without it the entry cannot be matched exactly.
  source: z.object({
    provider: z.string().regex(/^[a-z_]{1,20}$/),
    id: z.string().regex(/^[A-Za-z0-9_./:-]{1,64}$/),
  }),
  status: z.enum(libraryStatuses),
  progress: z.number().int().min(0).max(progressMax),
  // Missing in a file from before books and manga had a total; both then read as "none".
  progressUnit: z.enum(progressUnits).nullable().catch(null),
  progressTotal: z
    .number()
    .int()
    .min(1)
    .max(progressMax)
    .nullable()
    .catch(null),
  score: z.number().int().min(1).max(10).nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
  notes: shortText(notesMaxLength).nullable(),
  // Missing or unknown (a file from an older export, or edited by hand) reads as private.
  visibility: z.enum(["public", "friends", "private"]).catch("private"),
  // Missing (a file from before the switch existed) or anything but false reads as on, which is what
  // an entry did before there was a switch (SAG-101).
  notifyNewEpisodes: z.boolean().catch(true),
  viewings: z.array(viewingSchema).max(maxViewings).catch([]),
});

export type ImportEntry = z.output<typeof importEntrySchema>;

/**
 * An entry from a tracker that has no id of ours (an anime in a Simkl backup without a TMDB id,
 * SAG-243). It carries the name and the year of the entry instead of a source: the queue looks
 * for the title on TMDB (`matchByYear`) and the entry then goes on like any other.
 */
export const matchEntrySchema = importEntrySchema
  .omit({ source: true })
  .extend({
    match: z.object({
      kind: z.enum(["movie", "tv"]),
      title: z.string().trim().min(1).max(300),
      year: z.number().int().min(1800).max(2200),
    }),
  });

export type MatchEntry = z.output<typeof matchEntrySchema>;

/** Why an entry is left out of an import. Each code has its text under library.import.reasons. */
export type SkipReason =
  | "invalid"
  | "no_source"
  | "duplicate"
  | "unsupported_provider"
  | "not_found"
  | "failed";

export type Skipped = { title: string; reason: SkipReason };

export type ParsedImport = {
  entries: { key: string; entry: ImportEntry }[];
  /** Entries to look for by name and year once they are queued; never asked in the request. */
  toMatch: { key: string; entry: MatchEntry }[];
  skipped: Skipped[];
};

export type ParseError = "invalid_file" | "unsupported_version" | "too_many";

export const keyOf = (source: { provider: string; id: string }) =>
  `${source.provider}:${source.id}`;

const fileSchema = z.object({
  schemaVersion: z.number(),
  libraryEntries: z.array(z.unknown()),
});

/**
 * Reads the text of a file made by the data export, or a Simkl JSON backup (SAG-242). The file is data from outside, so only the
 * library entries are read and only the fields of `importEntrySchema`: the profile, the lists and an id
 * of a person in the file are never looked at. An entry that does not pass is left
 * out and listed, and the rest still import. Two entries of the same title count once.
 */
export function parseImportFile(
  text: string,
): { ok: true; value: ParsedImport } | { ok: false; error: ParseError } {
  if (new TextEncoder().encode(text).byteLength > maxImportBytes) {
    return { ok: false, error: "invalid_file" };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Broken text, or nesting so deep that the parser gives up: both are "not a valid file".
    return { ok: false, error: "invalid_file" };
  }

  // A Simkl backup is converted to the entries of our own export and then checked the same way.
  let rawEntries: unknown[];
  if (isSimklBackup(json)) {
    if (simklEntryCount(json) > maxImportEntries) {
      return { ok: false, error: "too_many" };
    }
    rawEntries = convertSimklBackup(json);
  } else {
    const file = fileSchema.safeParse(json);
    if (!file.success) return { ok: false, error: "invalid_file" };
    if (file.data.schemaVersion !== 1) {
      return { ok: false, error: "unsupported_version" };
    }
    if (file.data.libraryEntries.length > maxImportEntries) {
      return { ok: false, error: "too_many" };
    }
    rawEntries = file.data.libraryEntries;
  }

  const entries: ParsedImport["entries"] = [];
  const toMatch: ParsedImport["toMatch"] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  for (const raw of rawEntries) {
    const label = titleOf(raw);
    if (hasMatch(raw) && !hasSource(raw)) {
      const parsed = matchEntrySchema.safeParse(raw);
      if (!parsed.success || !datesInOrder(parsed.data)) {
        skipped.push({ title: label, reason: "invalid" });
        continue;
      }
      // Two seasons of one series are different here (they may fit one series later, and the queue
      // lists the second one as repeated then); only the same name and year twice is a duplicate.
      const { kind, title, year } = parsed.data.match;
      const key = `match:${kind}:${year}:${title.toLowerCase()}`;
      if (seen.has(key)) {
        skipped.push({ title: label, reason: "duplicate" });
        continue;
      }
      seen.add(key);
      toMatch.push({ key, entry: parsed.data });
      continue;
    }
    if (!hasSource(raw)) {
      skipped.push({ title: label, reason: "no_source" });
      continue;
    }
    const parsed = importEntrySchema.safeParse(raw);
    if (!parsed.success || !datesInOrder(parsed.data)) {
      skipped.push({ title: label, reason: "invalid" });
      continue;
    }
    const key = keyOf(parsed.data.source);
    if (seen.has(key)) {
      skipped.push({ title: label, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    entries.push({ key, entry: parsed.data });
  }
  return { ok: true, value: { entries, toMatch, skipped } };
}

function titleOf(raw: unknown): string {
  const title = (raw as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title.slice(0, 300) : "";
}

function hasMatch(raw: unknown): boolean {
  const match = (raw as { match?: unknown } | null)?.match;
  return typeof match === "object" && match !== null;
}

function hasSource(raw: unknown): boolean {
  const source = (raw as { source?: unknown } | null)?.source;
  return typeof source === "object" && source !== null;
}

function datesInOrder(
  entry: Pick<ImportEntry, "startedAt" | "finishedAt" | "viewings">,
): boolean {
  const ordered = (from: string | null, to: string | null) =>
    !from || !to || to >= from;
  return (
    ordered(entry.startedAt, entry.finishedAt) &&
    entry.viewings.every((viewing) =>
      ordered(viewing.startedOn, viewing.finishedOn),
    )
  );
}

/**
 * What an imported entry becomes, with the same rules as the editor (`applySave`) except that no
 * date is invented: a title marked completed has all its episodes (or pages, chapters, volumes)
 * done, the progress never passes the end, progress made means it is not just planned, and the
 * finish date only belongs to a completed title. A unit and a total only stay on a book or a
 * manga, in a unit that kind of title can count. The visibility of the file is used only when the
 * person asks to keep it (`keepVisibility`); otherwise an import never makes anything public. It
 * only applies to a new entry: one the person already has keeps its own.
 */
export function normalizeImported(
  entry: ImportEntry,
  title: { episodes: number; type: string },
  keepVisibility = false,
): {
  status: LibraryStatus;
  progress: number;
  progressUnit: ImportEntry["progressUnit"];
  progressTotal: number | null;
  score: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
  visibility: ImportEntry["visibility"];
  notifyNewEpisodes: boolean;
} {
  let { status, progress } = entry;
  const allowed = progressUnitsFor(title.type);
  const progressUnit =
    allowed.find((unit) => unit === entry.progressUnit) ?? allowed[0] ?? null;
  const progressTotal = progressUnit ? entry.progressTotal : null;
  const total = progressUnit ? (progressTotal ?? 0) : title.episodes;
  if (total > 0) {
    progress = status === "completed" ? total : Math.min(progress, total);
  }
  if (status === "planned" && progress > 0) status = "in_progress";
  return {
    status,
    progress,
    progressUnit,
    progressTotal,
    score: entry.score,
    startedAt: entry.startedAt,
    finishedAt: status === "completed" ? entry.finishedAt : null,
    notes: entry.notes,
    visibility: keepVisibility ? entry.visibility : "private",
    notifyNewEpisodes: entry.notifyNewEpisodes,
  };
}
