import { useTranslation } from "react-i18next";

import { readingContext } from "~/lib/media";
import type { LibraryEntryData } from "~/routes/library.$mediaId";

/**
 * What the pieces of the entry page share (SAG-121): the look of a field, the codes of its errors
 * and the helpers that draw them, so each piece does not write them again.
 */
export const inputClass =
  "border-input-edge bg-surface text-fg focus-visible:outline-accent mt-1 block w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2";

// Each code has its text in app/locales, under library.errors.
export type ErrorCode =
  | "invalid"
  | "progress_too_high"
  | "dates_order"
  | "notes_too_long"
  | "not_completed"
  | "viewings_limit"
  | "conflict"
  | "generic";

export type Field =
  | "status"
  | "progress"
  | "progressUnit"
  | "progressTotal"
  | "score"
  | "startedAt"
  | "finishedAt"
  | "notes"
  | "visibility"
  | "viewStartedOn"
  | "viewFinishedOn"
  | "viewNotes"
  | "viewings"
  | "form";

export type FieldErrors = Partial<Record<Field, ErrorCode>>;

/**
 * The lists and limits that live in `server/`, which a component may not import: the route hands
 * them over.
 */
export type EntryLimits = {
  statuses: readonly LibraryEntryData["entry"]["status"][];
  visibilityLevels: readonly LibraryEntryData["entry"]["visibility"][];
  notesMax: number;
  viewingNotesMax: number;
};

export type EntryErrors = ReturnType<typeof useEntryErrors>;

/** The words and the marks of the errors of the entry page, for one kind of title. */
export function useEntryErrors(errors: FieldErrors, mediaType: string) {
  const { t } = useTranslation();
  const hasErrors = Object.keys(errors).length > 0;
  // The errors of the three viewing forms are shown once, above the list.
  const viewingError =
    errors.viewings ??
    errors.viewFinishedOn ??
    errors.viewStartedOn ??
    errors.viewNotes;
  const context = readingContext(mediaType);
  const errorText = (code: ErrorCode) =>
    code === "not_completed"
      ? t("library.errors.not_completed", { context })
      : t(`library.errors.${code}`);

  const fieldError = (field: Field) =>
    errors[field] ? (
      <p
        id={`${field}-error`}
        className="text-danger-text mt-1 text-sm font-semibold"
      >
        {errorText(errors[field])}
      </p>
    ) : null;
  const invalid = (field: Field, hint?: string) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby":
      [hint, errors[field] ? `${field}-error` : undefined]
        .filter(Boolean)
        .join(" ") || undefined,
  });

  return { hasErrors, viewingError, context, errorText, fieldError, invalid };
}
