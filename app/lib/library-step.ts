/** What the quick "+1" of a library row needs to know about it. */
export type StepRow = {
  status: string;
  progress: number;
  totalEpisodes: number;
  progressUnit: string | null;
  progressTotal: number | null;
};

/**
 * Whether a row has a "+1": a title that counts something (episodes of the catalog, or the pages,
 * chapters or volumes of a book or a manga), that is not completed, and that has not reached the
 * end. A book with no total has no end, so it can always go one more.
 */
export function canStep(row: StepRow): boolean {
  if (row.status === "completed") return false;
  const total = row.progressUnit ? (row.progressTotal ?? 0) : row.totalEpisodes;
  if (!row.progressUnit && total === 0) return false;
  return total === 0 || row.progress < total;
}
