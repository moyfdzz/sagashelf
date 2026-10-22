import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import {
  applyTheme,
  effectiveTheme,
  oppositeTheme,
  type Theme,
} from "~/lib/theme";

const darkQuery = "(prefers-color-scheme: dark)";

function subscribeToSystem(onChange: () => void) {
  const query = window.matchMedia(darkQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemIsDark = () => window.matchMedia(darkQuery).matches;
// The server cannot know the system setting. It draws the light switch, and the browser
// corrects it right after the page loads (the page itself follows the system through CSS).
const serverSystemIsDark = () => false;

/**
 * Switches the page between light and dark. It is a switch, so a screen reader says whether dark
 * mode is on, and its label says what it does. It starts from the person's saved choice, else
 * from the system setting, else light, and it keeps in step with the system until a choice is made.
 */
export function ThemeSwitch({ saved }: { saved: Theme | null }) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<Theme | null>(saved);
  const systemDark = useSyncExternalStore(
    subscribeToSystem,
    systemIsDark,
    serverSystemIsDark,
  );
  const theme = effectiveTheme(chosen, systemDark);
  const dark = theme === "dark";

  function toggle() {
    const next = oppositeTheme(theme);
    setChosen(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t("theme.darkMode")}
      onClick={toggle}
      className="border-input-edge text-fg-muted hover:text-accent hover:bg-fg/10 focus-visible:outline-accent flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {dark ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-5"
          fill="currentColor"
        >
          <path d="M17.3 11.9A7.5 7.5 0 0 1 8.1 2.7a.75.75 0 0 0-1-.9 8.5 8.5 0 1 0 11.1 11.1.75.75 0 0 0-.9-1Z" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-5"
          fill="currentColor"
        >
          <path d="M10 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-12a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2Zm0 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15Zm8-5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10Zm9.66-4.66a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM7.46 12.54a.75.75 0 0 1 0 1.06L6.4 14.66a.75.75 0 1 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0Zm7.2 2.12a.75.75 0 0 1-1.06 0l-1.06-1.06a.75.75 0 1 1 1.06-1.06l1.06 1.06a.75.75 0 0 1 0 1.06ZM7.46 7.46a.75.75 0 0 1-1.06 0L5.34 6.4A.75.75 0 0 1 6.4 5.34l1.06 1.06a.75.75 0 0 1 0 1.06Z" />
        </svg>
      )}
    </button>
  );
}
