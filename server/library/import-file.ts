import { z } from "zod";

import {
  libraryStatuses,
  notesMaxLength,
  progressMax,
  viewingNotesMaxLength,
} from "./schema";
import type { LibraryStatus } from "./schema";
import { maxViewings } from "../db/viewings";

/** The most bytes of a file to import. A library of 500 titles with notes is far under it. */
export const maxImportBytes = 1024 * 1024;
/** The most entries one file may hold. */
export const maxImportEntries = 500;
/**
 * The most titles that are not in our database yet and are asked of the provider in one import.
 * Each takes between 2 and 6 subrequests, and the Free plan allows 50 for the whole request.
 */
export const maxNewTitles = 6;

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
const entrySchema = z.object({
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
  score: z.number().int().min(1).max(10).nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
  notes: shortText(notesMaxLength).nullable(),
  viewings: z.array(viewingSchema).max(maxViewings).catch([]),
});

export type ImportEntry = z.output<typeof entrySchema>;

/** Why an entry is left out of an import. Each code has its text under library.import.reasons. */
export type SkipReason =
  | "invalid"
  | "no_source"
  | "duplicate"
  | "unsupported_provider"
  | "not_found"
  | "pending";

export type Skipped = { title: string; reason: SkipReason };

export type ParsedImport = {
  entries: { key: string; entry: ImportEntry }[];
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
 * Reads the text of a file made by the data export. The file is data from outside, so only the
 * library entries are read and only the fields of `entrySchema`: the profile, the lists, an id of
 * a person or a visibility in the file are never looked at. An entry that does not pass is left
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

  const file = fileSchema.safeParse(json);
  if (!file.success) return { ok: false, error: "invalid_file" };
  if (file.data.schemaVersion !== 1) {
    return { ok: false, error: "unsupported_version" };
  }
  if (file.data.libraryEntries.length > maxImportEntries) {
    return { ok: false, error: "too_many" };
  }

  const entries: ParsedImport["entries"] = [];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  for (const raw of file.data.libraryEntries) {
    const label = titleOf(raw);
    if (!hasSource(raw)) {
      skipped.push({ title: label, reason: "no_source" });
      continue;
    }
    const parsed = entrySchema.safeParse(raw);
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
  return { ok: true, value: { entries, skipped } };
}

function titleOf(raw: unknown): string {
  const title = (raw as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title.slice(0, 300) : "";
}

function hasSource(raw: unknown): boolean {
  const source = (raw as { source?: unknown } | null)?.source;
  return typeof source === "object" && source !== null;
}

function datesInOrder(entry: ImportEntry): boolean {
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
 * date is invented: a title marked completed has all its episodes seen, the progress never passes
 * the last episode, episodes seen mean it is not just planned, and the finish date only belongs to
 * a completed title. The visibility is not an input at all: an import never makes anything public.
 */
export function normalizeImported(
  entry: ImportEntry,
  totalEpisodes: number,
): {
  status: LibraryStatus;
  progress: number;
  score: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
} {
  let { status, progress } = entry;
  if (totalEpisodes > 0) {
    progress =
      status === "completed"
        ? totalEpisodes
        : Math.min(progress, totalEpisodes);
  }
  if (status === "planned" && progress > 0) status = "in_progress";
  return {
    status,
    progress,
    score: entry.score,
    startedAt: entry.startedAt,
    finishedAt: status === "completed" ? entry.finishedAt : null,
    notes: entry.notes,
  };
}
