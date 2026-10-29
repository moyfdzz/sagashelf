export const entryStatuses = [
  "planned",
  "in_progress",
  "completed",
  "paused",
  "dropped",
] as const;
export type EntryStatus = (typeof entryStatuses)[number];

export const isEntryStatus = (value: unknown): value is EntryStatus =>
  (entryStatuses as readonly unknown[]).includes(value);

/** What the title page knows about the entry of the person. `status` is null when there is none. */
export type TitleEntry = {
  status: EntryStatus | null;
  progress: number;
  progressUnit: "pages" | "chapters" | "volumes" | null;
  progressTotal: number | null;
  totalEpisodes: number;
};

/** What the person has just asked for and the server has not answered yet. */
export type Pending = {
  adding: boolean;
  /** The status of a button that was pressed, as the form sent it. */
  status: unknown;
  stepping: boolean;
};

/** How many the title has: the total the person typed, or the episodes of the catalog. 0 if unknown. */
export const totalOf = (entry: TitleEntry): number =>
  entry.progressUnit ? (entry.progressTotal ?? 0) : entry.totalEpisodes;

/**
 * The entry as the person expects to see it right after pressing a button, before the server
 * answers, following the same rules the server will apply: a new entry is planned, a completed
 * title has everything seen, a planned title with progress is in progress, and the last step
 * completes a title that was planned or in progress. When the server refuses, nothing is pending
 * any more and the real entry is shown again.
 */
export function shownEntry(
  entry: TitleEntry,
  pending: Pending,
): { status: EntryStatus | null; progress: number } {
  const total = totalOf(entry);
  let status = entry.status;
  let progress = entry.progress;

  if (!status && pending.adding) status = "planned";

  if (isEntryStatus(pending.status)) {
    status = pending.status;
    if (status === "completed" && total > 0) progress = total;
    if (status === "planned" && progress > 0) status = "in_progress";
  }

  if (pending.stepping && status) {
    progress += 1;
    if (status === "planned") status = "in_progress";
    if (status === "in_progress" && total > 0 && progress >= total) {
      status = "completed";
    }
  }

  return { status, progress };
}
