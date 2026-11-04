import { useTranslation } from "react-i18next";

import { NotesPreview } from "~/components/NotesPreview";
import { progressOf } from "~/components/Progress";
import { canStep } from "~/lib/library-step";
import { readingContext } from "~/lib/media";
import type { LibraryData } from "~/routes/library";
import {
  Bar,
  Cover,
  ProgressWords,
  StepButton,
  TitleLink,
  VisibilityTag,
  type Row,
} from "./parts";

/** The entries of one section, drawn as covers, as titles or as a grid. */
export function Entries({
  rows,
  view,
}: {
  rows: Row[];
  view: LibraryData["view"];
}) {
  const { t } = useTranslation();

  if (view === "titles") {
    return (
      <ul className="mt-3">
        {rows.map((row) => (
          <li
            key={row.mediaId}
            className="border-border flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0"
          >
            <p className="min-w-0 font-semibold">
              <TitleLink row={row} />
            </p>
            <div className="text-fg-muted flex shrink-0 items-center gap-2 text-sm tabular-nums">
              {row.notes ? (
                <NotesPreview
                  title={row.title}
                  notes={row.notes}
                  entryHref={`/library/${row.mediaId}`}
                />
              ) : null}
              <VisibilityTag row={row} />
              {row.score ? (
                t("library.card.scoreShort", { score: row.score })
              ) : (
                <>
                  <span aria-hidden="true">
                    {t("library.card.noScoreMark")}
                  </span>
                  <span className="sr-only">{t("library.editor.noScore")}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (view === "grid") {
    return (
      <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {rows.map((row) => (
          <li key={row.mediaId} className="group/card min-w-0">
            <div className="group-focus-within/card:ring-accent group-hover/card:ring-accent relative overflow-hidden rounded ring-2 ring-transparent transition-colors">
              <Cover
                row={row}
                className="aspect-[2/3] w-full rounded object-cover"
              />
              <VisibilityTag
                row={row}
                className="absolute top-2 left-2 shadow"
              />
              {row.score ? (
                <p className="bg-surface-raised text-fg absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-xs font-bold shadow">
                  <span aria-hidden="true">
                    {t("library.card.badge", { score: row.score })}
                  </span>
                  <span className="sr-only">
                    {t("library.card.score", { score: row.score })}
                  </span>
                </p>
              ) : null}
              <Bar row={row} className="absolute right-0 bottom-0 left-0" />
            </div>
            <p className="mt-2 text-sm font-semibold break-words">
              <TitleLink row={row} />
            </p>
            <div className="mt-1">
              {row.notes ? (
                <NotesPreview
                  title={row.title}
                  notes={row.notes}
                  entryHref={`/library/${row.mediaId}`}
                />
              ) : null}
            </div>
            <ProgressWords row={row} className="sr-only" />
            <div className="mt-1">
              <StepButton row={row} />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-3 space-y-3">
      {rows.map((row) => (
        <li
          key={row.mediaId}
          className="border-border bg-surface-raised hover:border-accent focus-within:border-accent flex gap-4 rounded-md border p-4 transition-colors hover:shadow-sm"
        >
          <Cover row={row} className="h-[120px] w-20 shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">
              <TitleLink row={row} />
            </p>
            <div className="text-fg-muted mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
              {t("library.card.line", {
                kind: t(`media.kinds.${row.type as "movie"}`),
                status: t(`library.status.${row.status}`),
              })}
              <VisibilityTag row={row} />
              {row.notes ? (
                <NotesPreview
                  title={row.title}
                  notes={row.notes}
                  entryHref={`/library/${row.mediaId}`}
                />
              ) : null}
            </div>
            {progressOf(row) || canStep(row) ? (
              <div className="mt-2 max-w-xs">
                <ProgressWords row={row} className="text-sm" />
                <Bar row={row} className="mt-1" />
                <div className="mt-2">
                  <StepButton row={row} />
                </div>
              </div>
            ) : null}
            {row.timesWatched > 0 ? (
              <p className="mt-2 text-sm">
                {t("library.card.watched", {
                  count: row.timesWatched,
                  context: readingContext(row.type),
                })}
              </p>
            ) : null}
            <p className="mt-2 text-sm">
              {row.score
                ? t("library.card.score", { score: row.score })
                : t("library.editor.noScore")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
