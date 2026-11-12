import { useTranslation } from "react-i18next";

import { contentId } from "~/lib/skip";

/**
 * The first control of every page (SAG-256): a keyboard user presses Tab once and Enter to jump the
 * header and its controls straight to the content. It is hidden until it has the focus, and then it
 * hangs over the top left of the page, so it moves nothing.
 *
 * It is a plain anchor to the box that holds the page, which works without JavaScript. With
 * JavaScript the focus goes to the `<main>` of the page instead: a screen reader announces a
 * landmark, and says nothing useful about a box, and the address does not get a `#content` that a
 * reload would scroll to.
 */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href={`#${contentId}`}
      onClick={(event) => {
        const main = document.querySelector<HTMLElement>("main");
        if (!main) return;
        event.preventDefault();
        main.tabIndex = -1;
        main.focus();
      }}
      className="bg-accent text-accent-fg focus-visible:outline-accent sr-only rounded-md font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {t("nav.skipToContent")}
    </a>
  );
}
