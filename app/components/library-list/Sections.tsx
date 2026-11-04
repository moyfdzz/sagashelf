import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { LibraryData, LibraryPathChange } from "~/routes/library";
import { secondaryLinkClass } from "~/lib/ui";
import { Entries } from "./Entries";

// The color of the stripe of a section. It reuses the colors of the design (light and dark); the
// name of the section is always written, so the color is never the only signal.
const stripe: Record<LibraryData["sections"][number]["status"], string> = {
  in_progress: "border-l-accent",
  planned: "border-l-fg-muted",
  paused: "border-l-fg-muted",
  dropped: "border-l-danger-edge",
  completed: "border-l-success-edge",
};

type Props = {
  sections: LibraryData["sections"];
  query: LibraryData["query"];
  view: LibraryData["view"];
  searching: boolean;
  pathTo: (change: LibraryPathChange) => string;
};

/** One collapsible block for each status, with its entries and its own pages. */
export function Sections({ sections, query, view, searching, pathTo }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 space-y-4">
      {sections.map((section) => {
        const name = t(`library.status.${section.status}`);
        // The one with the finished titles is the long one: it starts closed, and opens by
        // itself when the person is looking for something or is on its later pages.
        const open =
          section.total > 0 &&
          (section.status !== "completed" || searching || section.page > 1);
        return (
          <details
            key={`${query.type ?? "all"}-${section.status}`}
            open={open}
            className={`group/section border-border rounded-md border border-l-4 p-4 ${stripe[section.status]}`}
          >
            <summary className="focus-visible:outline-accent flex cursor-pointer list-none items-center justify-between gap-3 rounded text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-3">
                {name}
                <span className="border-border bg-surface-raised text-fg-muted rounded-full border px-2.5 py-0.5 text-sm font-semibold">
                  {t("library.badge", { count: section.total })}
                </span>
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-fg-muted shrink-0 transition-transform group-open/section:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            {section.total === 0 ? (
              <p className="text-fg-muted mt-3">
                {t("library.sections.empty", { section: name })}
              </p>
            ) : (
              <>
                <Entries rows={section.rows} view={view} />
                {section.pages > 1 ? (
                  <nav
                    aria-label={t("library.pagination.label", {
                      section: name,
                    })}
                    className="mt-4 flex items-center justify-between gap-4"
                  >
                    {section.page > 1 ? (
                      <Link
                        to={pathTo({
                          section: {
                            status: section.status,
                            page: section.page - 1,
                          },
                        })}
                        rel="prev"
                        className={secondaryLinkClass}
                      >
                        {t("library.pagination.previous")}
                      </Link>
                    ) : (
                      <span />
                    )}
                    <p className="text-fg-muted">
                      {t("library.pagination.page", {
                        page: section.page,
                        pages: section.pages,
                      })}
                    </p>
                    {section.page < section.pages ? (
                      <Link
                        to={pathTo({
                          section: {
                            status: section.status,
                            page: section.page + 1,
                          },
                        })}
                        rel="next"
                        className={secondaryLinkClass}
                      >
                        {t("library.pagination.next")}
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}
              </>
            )}
          </details>
        );
      })}
    </div>
  );
}
