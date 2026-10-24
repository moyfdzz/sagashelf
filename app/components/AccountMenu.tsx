import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const itemClass =
  "text-fg hover:bg-fg/10 focus-visible:outline-accent block rounded-md px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2";

/**
 * The account menu of a signed-in person: a button that shows or hides a list of links. The links
 * are plain anchors, so each one loads a whole new page (the settings and sign-out pages have
 * their own security policy, which only a new document gets) and the menu starts closed there.
 * Escape and a click outside close it, and Escape gives the focus back to the button.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="border-input-edge text-fg-muted hover:text-accent hover:bg-fg/10 focus-visible:outline-accent flex items-center gap-2 rounded-md border px-3 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t("nav.account")}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-4"
          fill="currentColor"
        >
          <path d="M5.5 7.5 10 12l4.5-4.5-1.1-1.1L10 9.8 6.6 6.4z" />
        </svg>
      </button>
      <ul
        id={panelId}
        hidden={!open}
        className="bg-surface-raised border-border absolute right-0 z-40 mt-2 w-60 rounded-md border p-1 shadow-lg"
      >
        <li>
          <a href="/settings/profile" className={itemClass}>
            {t("nav.settings")}
          </a>
        </li>
        <li>
          <a href="/sign-out" className={itemClass}>
            {t("nav.signOut")}
          </a>
        </li>
      </ul>
    </div>
  );
}
