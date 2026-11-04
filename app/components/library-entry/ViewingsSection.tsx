import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { CountedTextarea } from "~/components/CountedTextarea";
import { useFormatters } from "~/lib/format";
import type { LibraryEntryData } from "~/routes/library.$mediaId";
import { primaryButtonClass, secondaryButtonClass } from "~/lib/ui";
import { inputClass, type EntryErrors, type EntryLimits } from "./shared";

type Props = {
  entry: LibraryEntryData["entry"];
  viewings: LibraryEntryData["viewings"];
  watchedCount: number;
  errors: EntryErrors;
  limits: EntryLimits;
};

/** The history of every time the title was watched or read, and the buttons to change it. */
export function ViewingsSection({
  entry,
  viewings,
  watchedCount,
  errors: { context, viewingError, errorText },
  limits: { viewingNotesMax: viewingNotesMaxLength },
}: Props) {
  const { t } = useTranslation();
  const { formatDate } = useFormatters();
  const dayText = (value: string) =>
    formatDate(Date.parse(`${value}T00:00:00Z`));
  const viewingDates = (from: string | null, to: string | null) =>
    t("library.editor.viewings.dates", {
      context: from && to ? "range" : from ? "from" : to ? "to" : "none",
      from: from ? dayText(from) : "",
      to: to ? dayText(to) : "",
    });

  return (
    <section className="border-border mt-10 border-t pt-6">
      <h2 className="text-xl font-semibold">
        {t("library.editor.viewings.title", { context })}
      </h2>
      <p className="text-fg-muted mt-1">
        {t("library.editor.viewings.count", {
          count: watchedCount,
          context,
        })}
      </p>
      {viewingError ? (
        <p role="alert" className="text-danger-text mt-2 font-semibold">
          {errorText(viewingError)}
        </p>
      ) : null}
      {viewings.length === 0 ? (
        <p className="text-fg-muted mt-3 text-sm">
          {t("library.editor.viewings.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {viewings.map((viewing) => (
            <li
              key={viewing.id}
              className="border-border bg-surface-raised rounded-md border"
            >
              <details>
                <summary className="cursor-pointer px-4 py-3">
                  <span className="font-semibold">
                    {viewingDates(viewing.startedOn, viewing.finishedOn)}
                  </span>
                  {viewing.notes ? (
                    <span className="text-fg-muted block text-sm">
                      {viewing.notes}
                    </span>
                  ) : null}
                </summary>
                <Form
                  method="post"
                  key={JSON.stringify(viewing)}
                  className="border-border space-y-4 border-t px-4 py-4"
                >
                  <input type="hidden" name="viewingId" value={viewing.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor={`viewStartedOn-${viewing.id}`}
                        className="font-semibold"
                      >
                        {t("library.editor.startedAt")}
                      </label>
                      <input
                        id={`viewStartedOn-${viewing.id}`}
                        name="viewStartedOn"
                        type="date"
                        defaultValue={viewing.startedOn ?? ""}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`viewFinishedOn-${viewing.id}`}
                        className="font-semibold"
                      >
                        {t("library.editor.finishedAt")}
                      </label>
                      <input
                        id={`viewFinishedOn-${viewing.id}`}
                        name="viewFinishedOn"
                        type="date"
                        defaultValue={viewing.finishedOn ?? ""}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor={`viewNotes-${viewing.id}`}
                      className="font-semibold"
                    >
                      {t("library.editor.viewings.notes")}
                    </label>
                    <CountedTextarea
                      id={`viewNotes-${viewing.id}`}
                      name="viewNotes"
                      rows={2}
                      max={viewingNotesMaxLength}
                      defaultValue={viewing.notes ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      name="intent"
                      value="viewing_save"
                      className={primaryButtonClass}
                    >
                      {t("library.editor.viewings.save")}
                    </button>
                    <button
                      type="submit"
                      name="intent"
                      value="viewing_remove"
                      className={secondaryButtonClass}
                    >
                      {t("library.editor.viewings.remove")}
                    </button>
                  </div>
                </Form>
              </details>
            </li>
          ))}
        </ul>
      )}

      <details className="border-border mt-4 rounded-md border">
        <summary className="cursor-pointer px-4 py-3 font-semibold">
          {t("library.editor.viewings.add")}
        </summary>
        <Form
          method="post"
          key={`add-${viewings.length}`}
          className="border-border space-y-4 border-t px-4 py-4"
        >
          <input type="hidden" name="intent" value="viewing_add" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="viewStartedOn" className="font-semibold">
                {t("library.editor.startedAt")}
              </label>
              <input
                id="viewStartedOn"
                name="viewStartedOn"
                type="date"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="viewFinishedOn" className="font-semibold">
                {t("library.editor.finishedAt")}
              </label>
              <input
                id="viewFinishedOn"
                name="viewFinishedOn"
                type="date"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="viewNotes" className="font-semibold">
              {t("library.editor.viewings.notes")}
            </label>
            <CountedTextarea
              id="viewNotes"
              name="viewNotes"
              rows={2}
              max={viewingNotesMaxLength}
              aria-describedby="viewNotes-hint"
              className={inputClass}
            />
            <p id="viewNotes-hint" className="text-fg-muted mt-1 text-sm">
              {t("library.editor.viewings.notesHint", {
                max: viewingNotesMaxLength,
              })}
            </p>
          </div>
          <button type="submit" className={primaryButtonClass}>
            {t("library.editor.viewings.addSubmit")}
          </button>
        </Form>
      </details>

      {entry.status === "completed" ? (
        <Form method="post" className="mt-3 space-y-2">
          <input type="hidden" name="intent" value="rewatch" />
          <button type="submit" className={secondaryButtonClass}>
            {t("library.editor.rewatch", { context })}
          </button>
          <p className="text-fg-muted text-sm">
            {t("library.editor.rewatchHint", { context })}
          </p>
        </Form>
      ) : null}
    </section>
  );
}
