import { useTranslation } from "react-i18next";
import { useFetcher, useFetchers } from "react-router";

import type { LibraryData } from "~/routes/library";
import type { action as stepAction } from "~/routes/library.$mediaId.step";
import { ProgressBar, ProgressText } from "~/components/Progress";
import { canStep } from "~/lib/library-step";
import { linkClass, smallButtonClass } from "~/lib/ui";

/** One entry of a section, as the page is given it. */
export type Row = LibraryData["sections"][number]["rows"][number];

export function Cover({ row, className }: { row: Row; className: string }) {
  const { t } = useTranslation();
  return row.poster ? (
    <img
      src={row.poster}
      alt={t("media.posterAlt", { title: row.title })}
      width={185}
      height={278}
      loading="lazy"
      className={className}
    />
  ) : (
    <div aria-hidden="true" className={`bg-border ${className}`} />
  );
}

export function TitleLink({ row }: { row: Row }) {
  const { t } = useTranslation();
  return (
    <>
      {/* A plain link: the entry page has its own security policy, which only a new document
          gets. */}
      <a href={`/library/${row.mediaId}`} className={linkClass}>
        {row.title}
      </a>
      {row.year ? (
        <span className="text-fg-muted font-normal">
          {" "}
          {t("search.year", { year: row.year })}
        </span>
      ) : null}
    </>
  );
}

/** Says who can see the entry, only when it is not private: most are, and a label on each would be noise. */
export function VisibilityTag({
  row,
  className = "",
}: {
  row: Row;
  className?: string;
}) {
  const { t } = useTranslation();
  if (row.visibility === "private") return null;
  return (
    <span
      className={`border-border bg-surface-raised text-fg-muted inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {t(`library.visibility.${row.visibility}`)}
    </span>
  );
}

const stepKey = (row: Row) => `step-${row.mediaId}`;

/**
 * The row as the person expects to see it right after pressing "+1": one more, before the server
 * has answered. When the step fails the fetcher is idle again and the real number comes back.
 */
function useShownRow(row: Row): Row {
  const pending = useFetchers().some(
    (fetcher) => fetcher.key === stepKey(row) && fetcher.state !== "idle",
  );
  return pending ? { ...row, progress: row.progress + 1 } : row;
}

/**
 * The quick "+1" of a row. A plain form that works without JavaScript (the server then sends the
 * person back to the library); with it, the number goes up at once and the page stays where it is.
 */
export function StepButton({ row }: { row: Row }) {
  const { t } = useTranslation();
  const fetcher = useFetcher<typeof stepAction>({ key: stepKey(row) });
  const shown = useShownRow(row);
  if (!canStep(shown)) return null;

  const answer = fetcher.data as { ok?: boolean } | undefined;
  const failed = fetcher.state === "idle" && answer !== undefined && !answer.ok;
  return (
    <>
      <fetcher.Form
        method="post"
        action={`/library/${row.mediaId}/step`}
        className="inline"
      >
        <button
          type="submit"
          disabled={fetcher.state !== "idle"}
          aria-label={t("library.card.step", {
            context: row.progressUnit ?? "episodes",
            title: row.title,
          })}
          className={smallButtonClass}
        >
          {t("library.card.stepShort")}
        </button>
      </fetcher.Form>
      {failed ? (
        <p role="alert" className="text-danger-text mt-1 text-sm font-semibold">
          {t("library.card.stepFailed")}
        </p>
      ) : null}
    </>
  );
}

/** The words of the progress of a row, with the step that is on its way already counted. */
export function ProgressWords({
  row,
  className,
}: {
  row: Row;
  className?: string;
}) {
  return <ProgressText row={useShownRow(row)} className={className} />;
}

/** The bar of the progress of a row, with the step that is on its way already counted. */
export function Bar({ row, className }: { row: Row; className: string }) {
  return <ProgressBar row={useShownRow(row)} className={className} />;
}
