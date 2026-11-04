import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { CountedTextarea } from "~/components/CountedTextarea";
import type { LibraryEntryData } from "~/routes/library.$mediaId";
import { primaryButtonClass } from "~/lib/ui";
import { inputClass, type EntryErrors, type EntryLimits } from "./shared";

type Props = {
  entry: LibraryEntryData["entry"];
  units: LibraryEntryData["progressUnits"];
  total: number;
  progressAt: LibraryEntryData["progressAt"];
  saving: boolean;
  errors: EntryErrors;
  limits: EntryLimits;
};

/** The fields of the entry: status, progress, score, dates, notes and visibility. */
export function EntryForm({
  entry,
  units,
  total,
  progressAt,
  saving,
  errors: { fieldError, invalid },
  limits: {
    statuses: libraryStatuses,
    visibilityLevels,
    notesMax: notesMaxLength,
  },
}: Props) {
  const { t } = useTranslation();
  // The finish date can only be set while the status is "completed".
  const [status, setStatus] = useState(entry.status);
  // A manga lets the person pick; the first unit is the default. A book has only pages.
  const [unit, setUnit] = useState(entry.progressUnit ?? units[0]);

  return (
    <>
      {/* A key from the saved values makes the fields show what was stored after a save. */}
      <Form
        method="post"
        key={JSON.stringify(entry)}
        className="mt-8 space-y-6"
      >
        <input type="hidden" name="intent" value="save" />

        <div>
          <label htmlFor="status" className="font-semibold">
            {t("library.editor.status")}
          </label>
          <select
            id="status"
            name="status"
            defaultValue={entry.status}
            onChange={(event) =>
              setStatus(event.target.value as typeof entry.status)
            }
            {...invalid("status")}
            className={inputClass}
          >
            {libraryStatuses.map((status) => (
              <option key={status} value={status}>
                {t(`library.status.${status}`)}
              </option>
            ))}
          </select>
          {fieldError("status")}
        </div>

        {unit ? (
          <>
            {units.length > 1 ? (
              <div>
                <label htmlFor="progressUnit" className="font-semibold">
                  {t("library.editor.progressUnit")}
                </label>
                <select
                  id="progressUnit"
                  name="progressUnit"
                  value={unit}
                  onChange={(event) =>
                    setUnit(event.target.value as typeof unit)
                  }
                  {...invalid("progressUnit")}
                  className={inputClass}
                >
                  {units.map((option) => (
                    <option key={option} value={option}>
                      {t(
                        `library.editor.progressUnitOptions.${option as "chapters"}`,
                      )}
                    </option>
                  ))}
                </select>
                {fieldError("progressUnit")}
              </div>
            ) : (
              <input type="hidden" name="progressUnit" value={unit} />
            )}
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="progress" className="font-semibold">
                  {t("library.editor.progressRead", { context: unit })}
                </label>
                <input
                  id="progress"
                  name="progress"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  defaultValue={entry.progress}
                  {...invalid("progress")}
                  className={inputClass}
                />
                {fieldError("progress")}
              </div>
              <div>
                <label htmlFor="progressTotal" className="font-semibold">
                  {t("library.editor.progressTotal", { context: unit })}
                </label>
                <input
                  id="progressTotal"
                  name="progressTotal"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={entry.progressTotal ?? ""}
                  {...invalid("progressTotal", "progressTotal-hint")}
                  className={inputClass}
                />
                <p
                  id="progressTotal-hint"
                  className="text-fg-muted mt-1 text-sm"
                >
                  {t("library.editor.progressTotalHint")}
                </p>
                {fieldError("progressTotal")}
              </div>
            </div>
          </>
        ) : total > 0 ? (
          <div>
            <label htmlFor="progress" className="font-semibold">
              {t("library.editor.progress")}
            </label>
            <input
              id="progress"
              name="progress"
              type="number"
              inputMode="numeric"
              min={0}
              max={total}
              defaultValue={entry.progress}
              {...invalid("progress", "progress-hint")}
              className={inputClass}
            />
            <p id="progress-hint" className="text-fg-muted mt-1 text-sm">
              {t("library.editor.progressHint", { total })}
              {progressAt
                ? ` ${t("library.editor.progressAt", progressAt)}`
                : ""}
            </p>
            {fieldError("progress")}
          </div>
        ) : (
          // A title with no episodes (a movie) keeps its progress as it is.
          <input type="hidden" name="progress" value={entry.progress} />
        )}

        <div>
          <label htmlFor="score" className="font-semibold">
            {t("library.editor.score")}
          </label>
          <select
            id="score"
            name="score"
            defaultValue={entry.score ?? ""}
            {...invalid("score")}
            className={inputClass}
          >
            <option value="">{t("library.editor.noScore")}</option>
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => (
              <option key={score} value={score}>
                {t("library.editor.scoreOption", { score })}
              </option>
            ))}
          </select>
          {fieldError("score")}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="startedAt" className="font-semibold">
              {t("library.editor.startedAt")}
            </label>
            <input
              id="startedAt"
              name="startedAt"
              type="date"
              defaultValue={entry.startedAt ?? ""}
              {...invalid("startedAt")}
              className={inputClass}
            />
            {fieldError("startedAt")}
          </div>
          <div>
            <label htmlFor="finishedAt" className="font-semibold">
              {t("library.editor.finishedAt")}
            </label>
            <input
              id="finishedAt"
              name="finishedAt"
              type="date"
              defaultValue={entry.finishedAt ?? ""}
              disabled={status !== "completed"}
              {...invalid("finishedAt", "finishedAt-hint")}
              className={`${inputClass} disabled:opacity-60`}
            />
            <p id="finishedAt-hint" className="text-fg-muted mt-1 text-sm">
              {t("library.editor.finishedAtHint")}
            </p>
            {fieldError("finishedAt")}
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="font-semibold">
            {t("library.editor.notes")}
          </label>
          <CountedTextarea
            id="notes"
            name="notes"
            rows={5}
            max={notesMaxLength}
            defaultValue={entry.notes ?? ""}
            {...invalid("notes", "notes-hint")}
            className={inputClass}
          />
          <p id="notes-hint" className="text-fg-muted mt-1 text-sm">
            {t("library.editor.notesHint", { max: notesMaxLength })}
          </p>
          {fieldError("notes")}
        </div>

        <div>
          <label htmlFor="visibility" className="font-semibold">
            {t("library.editor.visibility")}
          </label>
          <select
            id="visibility"
            name="visibility"
            defaultValue={entry.visibility}
            {...invalid("visibility", "visibility-hint")}
            className={inputClass}
          >
            {visibilityLevels.map((level) => (
              <option key={level} value={level}>
                {t(`library.editor.visibilityOptions.${level}`)}
              </option>
            ))}
          </select>
          <p id="visibility-hint" className="text-fg-muted mt-1 text-sm">
            {t("library.editor.visibilityHint")}
          </p>
          {fieldError("visibility")}
        </div>

        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {saving ? t("library.editor.saving") : t("library.editor.save")}
        </button>
      </Form>
    </>
  );
}
