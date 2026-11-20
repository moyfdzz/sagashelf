import type { AccountExport } from "./export";

// The CSV of "My data": the profile, the library and the earlier viewings. Split from
// `export.ts`, which builds the data, to keep each file under 600 lines (ADR-033).

/**
 * A cell that starts with `=`, `+`, `-` or `@` is run as a formula by spreadsheet programs, and
 * the bio is text anyone can write. A quote in front keeps it as text.
 */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const libraryColumns = [
  "title",
  "status",
  "progress",
  "progress_unit",
  "progress_total",
  "score",
  "started_at",
  "finished_at",
  "times_watched",
  "notes",
  "visibility",
  "added_at",
  "provider",
  "external_id",
] as const;

const viewingColumns = ["title", "started_on", "finished_on", "notes"] as const;

type EntrySource = { provider: string; id: string };

type EarlierViewing = {
  startedOn: string | null;
  finishedOn: string | null;
  notes: string | null;
};

const day = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

/**
 * The profile as a table of `field,value`, the library below it as a second table and the earlier
 * times each title was watched as a third, each with its own header after an empty line. Lists
 * and custom entries are in the JSON file.
 */
export function profileCsv(data: AccountExport): string {
  const rows: [string, unknown][] = [
    ["username", data.profile.username],
    ["display_name", data.profile.displayName],
    ["avatar_url", data.profile.avatarUrl],
    ["bio", data.profile.bio],
    ["language", data.profile.locale],
    ["privacy", data.profile.privacy],
    ["created_at", data.profile.createdAt],
  ];
  const lines = [
    "field,value",
    ...rows.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`),
  ];

  if (data.libraryEntries.length > 0) {
    lines.push("", libraryColumns.join(","));
    for (const entry of data.libraryEntries) {
      lines.push(
        [
          entry.title,
          entry.status,
          entry.progress,
          entry.progressUnit,
          entry.progressTotal,
          entry.score,
          entry.startedAt,
          entry.finishedAt,
          entry.timesWatched,
          entry.notes,
          entry.visibility,
          day(entry.createdAt),
          (entry.source as EntrySource | null)?.provider,
          (entry.source as EntrySource | null)?.id,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    // The earlier times of each title, as a third table. Left out when there are none.
    const viewingLines = data.libraryEntries.flatMap((entry) =>
      (entry.viewings as EarlierViewing[]).map((viewing) =>
        [entry.title, viewing.startedOn, viewing.finishedOn, viewing.notes]
          .map(csvCell)
          .join(","),
      ),
    );
    if (viewingLines.length > 0) {
      lines.push("", viewingColumns.join(","), ...viewingLines);
    }
  }
  return lines.join("\r\n") + "\r\n";
}
