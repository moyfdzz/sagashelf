import { useTranslation } from "react-i18next";

/** The `id` of the box that holds the page, which `root.tsx` draws and this link points to. */
export const contentId = "content";

/**
 * The first control of every page (SAG-256): a keyboard user presses Tab once and Enter to jump the
 * header and its controls straight to the content. It is hidden until it has the focus, and then it
 * hangs over the top left of the page, so it moves nothing. A plain anchor, so it works without
 * JavaScript: the browser moves the focus to the target, which has `tabindex="-1"` for that.
 */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href={`#${contentId}`}
      className="bg-accent text-accent-fg focus-visible:outline-accent sr-only rounded-md font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {t("nav.skipToContent")}
    </a>
  );
}
