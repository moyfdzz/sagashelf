import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Long enough to read, short enough not to stay in the way. The close button is there for
// anyone who needs more time, and the message is also announced by the page's live region.
const visibleMilliseconds = 7000;

/**
 * A short "it worked" message that appears over the page and goes away by itself. It only draws
 * the message: the page keeps an always-present `role="status"` region around it, so a screen
 * reader announces each new one. Without JavaScript it simply stays.
 */
export function StatusToast({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setOpen(false), visibleMilliseconds);
    return () => clearTimeout(timer);
  }, []);

  if (!open) return null;

  return (
    <div className="border-success-edge bg-success-bg text-success-fg pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 shadow-lg motion-safe:animate-toast-in">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="mt-0.5 size-5 shrink-0"
        fill="currentColor"
      >
        {/* evenodd cuts the check mark out of the circle instead of filling over it. */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.58 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
        />
      </svg>
      <p className="flex-1 font-semibold">{children}</p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={t("common.close")}
        className="focus-visible:outline-success-edge -m-1 rounded-md p-1 hover:bg-black/10 focus-visible:outline-2 dark:hover:bg-white/10"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-5"
          fill="currentColor"
        >
          <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
    </div>
  );
}
