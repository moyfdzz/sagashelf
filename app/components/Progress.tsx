import { useTranslation } from "react-i18next";

/** What the progress of a book or a manga counts. The same three words as the library keeps. */
export type ProgressUnit = "pages" | "chapters" | "volumes";

/** What a title counts for a person, as the library and the title page show it. */
export type ProgressRow = {
  progress: number;
  totalEpisodes: number;
  progressUnit: ProgressUnit | null;
  progressTotal: number | null;
};

type Progress = {
  done: number;
  /** 0 when the person never said how long their book or manga is. */
  total: number;
  unit: ProgressUnit | null;
};

/** What a row counts: episodes from the catalog, or the pages, chapters or volumes of the person. */
export function progressOf(row: ProgressRow): Progress | null {
  if (row.progressUnit) {
    const total = row.progressTotal ?? 0;
    if (total === 0 && row.progress === 0) return null;
    return { done: row.progress, total, unit: row.progressUnit };
  }
  return row.totalEpisodes > 0
    ? { done: row.progress, total: row.totalEpisodes, unit: null }
    : null;
}

// "2 de 12 episodios", "120 de 320 páginas" or, with no total, "120 páginas".
export function ProgressText({
  row,
  className,
}: {
  row: ProgressRow;
  className?: string;
}) {
  const { t } = useTranslation();
  const progress = progressOf(row);
  if (!progress) return null;
  const { done, total, unit } = progress;
  return (
    <p className={className}>
      {!unit
        ? t("library.card.progress", { done, total })
        : total > 0
          ? t("library.card.progressOf", { context: unit, count: total, done })
          : t("library.card.progressDone", { context: unit, count: done })}
    </p>
  );
}

// A native <progress>: a bar needs no inline style (the strict CSP forbids it) and no script. It is
// decorative, because the text next to it already says "2 of 12 episodes".
export function ProgressBar({
  row,
  className,
}: {
  row: ProgressRow;
  className: string;
}) {
  const progress = progressOf(row);
  // No bar until there is an end to measure against.
  if (!progress?.total) return null;
  return (
    <progress
      aria-hidden="true"
      value={Math.min(progress.done, progress.total)}
      max={progress.total}
      className={`bg-border [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-accent h-1.5 w-full appearance-none overflow-hidden rounded-full ${className}`}
    />
  );
}
