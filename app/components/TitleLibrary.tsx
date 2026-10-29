import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { ProgressBar, ProgressText } from "~/components/Progress";
import { canStep } from "~/lib/library-step";
import {
  entryStatuses,
  shownEntry,
  type TitleEntry,
} from "~/lib/title-library";
import {
  forwardLinkClass,
  primaryButtonClass,
  smallButtonClass,
  tabClass,
} from "~/lib/ui";

type Props = {
  id: string;
  title: string;
  entry: TitleEntry;
};

/**
 * What a signed-in person does with a title from its page: add it, change its status and count
 * one more, without leaving the page. Every form is a plain form that works without JavaScript,
 * where the server sends the person back here. With JavaScript, what was pressed shows at once
 * and, if the server refuses, the real entry comes back with a message.
 *
 * One fetcher serves the three forms, and every button is off while it saves, so there is never
 * more than one change on its way and the message is always about the last one. The page it
 * lives on does not load Clerk's script: the forms only need the session cookie.
 */
export function TitleLibrary({ id, title, entry }: Props) {
  const { t } = useTranslation();
  const fetcher = useFetcher({ key: `library-${id}` });

  const busy = fetcher.state !== "idle";
  // Which of the three forms is on its way, from the address it was sent to.
  const sentTo = busy ? (fetcher.formAction ?? "") : "";
  const shown = shownEntry(entry, {
    adding: sentTo.endsWith("/library/add"),
    status: sentTo.endsWith("/status") ? fetcher.formData?.get("status") : null,
    stepping: sentTo.endsWith("/step"),
  });
  const row = {
    status: shown.status ?? "planned",
    progress: shown.progress,
    totalEpisodes: entry.totalEpisodes,
    progressUnit: entry.progressUnit,
    progressTotal: entry.progressTotal,
  };

  // Only an answer that said "ok" is not a refusal.
  const answer = fetcher.data as { ok?: boolean } | undefined;
  const alert =
    !busy && answer !== undefined && !answer.ok ? (
      <p role="alert" className="text-danger-text mt-2 text-sm font-semibold">
        {t("media.library.failed")}
      </p>
    ) : null;

  if (!shown.status) {
    return (
      <>
        <fetcher.Form method="post" action="/library/add">
          <input type="hidden" name="mediaId" value={id} />
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {t("media.library.add")}
          </button>
        </fetcher.Form>
        {alert}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-semibold">{t("media.library.heading")}</p>

      <fetcher.Form method="post" action={`/library/${id}/status`}>
        <div
          role="group"
          aria-label={t("media.library.statusLabel")}
          className="flex flex-wrap gap-2"
        >
          {entryStatuses.map((option) => {
            const selected = shown.status === option;
            return (
              <button
                key={option}
                type="submit"
                name="status"
                value={option}
                aria-pressed={selected}
                // A title with progress is never "planned" again, so the button says it cannot be.
                disabled={
                  busy ||
                  (option === "planned" && shown.progress > 0 && !selected)
                }
                className={`${tabClass(selected)} disabled:opacity-50`}
              >
                {t(`library.status.${option}`)}
              </button>
            );
          })}
        </div>
      </fetcher.Form>

      {row.progressUnit || row.totalEpisodes > 0 ? (
        <div className="max-w-xs space-y-1">
          <ProgressText row={row} className="text-sm" />
          <ProgressBar row={row} className="" />
          {canStep(row) ? (
            <fetcher.Form
              method="post"
              action={`/library/${id}/step`}
              className="inline"
            >
              <button
                type="submit"
                disabled={busy}
                aria-label={t("library.card.step", {
                  context: row.progressUnit ?? "episodes",
                  title,
                })}
                className={smallButtonClass}
              >
                {t("library.card.stepShort")}
              </button>
            </fetcher.Form>
          ) : null}
        </div>
      ) : null}

      <p>
        {/* A plain link: the entry page has its own security policy, which only a new document
            gets. */}
        <a href={`/library/${id}`} className={forwardLinkClass}>
          {t("media.library.edit")}
        </a>
      </p>
      {alert}
    </div>
  );
}
