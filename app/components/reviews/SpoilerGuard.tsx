import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * Hides the text of a review marked as a spoiler behind a warning and a button that shows it anyway
 * (ADR-053). A `details` element: it works with the keyboard, a screen reader says whether it is
 * open, and it needs no JavaScript.
 */
export function SpoilerGuard({
  spoiler,
  children,
}: {
  spoiler: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!spoiler) return <>{children}</>;
  return (
    <div className="mt-2">
      <p className="text-fg-muted font-semibold">
        {t("reviews.spoilerWarning")}
      </p>
      <details className="mt-1">
        <summary className="hover:text-link-hover focus-visible:outline-accent inline-flex min-h-10 cursor-pointer items-center rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
          {t("reviews.showSpoiler")}
        </summary>
        {children}
      </details>
    </div>
  );
}
