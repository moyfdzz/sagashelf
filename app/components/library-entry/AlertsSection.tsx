import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import type { LibraryEntryData } from "~/routes/library.$mediaId";
import { secondaryButtonClass } from "~/lib/ui";

type Props = {
  entry: LibraryEntryData["entry"];
  saving: boolean;
};

/** The box that turns on the alerts of new episodes of this title (SAG-101). */
export function AlertsSection({ entry, saving }: Props) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="alerts-title" className="mt-8">
      <h2 id="alerts-title" className="text-2xl font-bold">
        {t("library.editor.alerts.title")}
      </h2>
      <Form
        method="post"
        // A key with the saved state puts the box back as it was saved after a save.
        key={String(entry.notifyNewEpisodes)}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="intent" value="notify" />
        <div className="flex items-start gap-3">
          <input
            id="notify-new-episodes"
            name="notify"
            value="on"
            type="checkbox"
            defaultChecked={entry.notifyNewEpisodes}
            className="mt-1 h-5 w-5 shrink-0"
            aria-describedby="notify-new-episodes-hint"
          />
          <div>
            <label htmlFor="notify-new-episodes" className="font-semibold">
              {t("library.editor.alerts.label")}
            </label>
            <p id="notify-new-episodes-hint" className="text-fg-muted text-sm">
              {t("library.editor.alerts.hint")}
              {/* A plain link: the settings pages have a security policy of their own (ADR-018). */}
              <a href="/settings/notifications" className="ml-1 underline">
                {t("library.editor.alerts.link")}
              </a>
            </p>
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className={secondaryButtonClass}
        >
          {t("library.editor.alerts.save")}
        </button>
      </Form>
    </section>
  );
}
