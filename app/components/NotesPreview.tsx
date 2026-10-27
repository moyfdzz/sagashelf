import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { previewNotes } from "~/lib/notes";
import { secondaryButtonClass, secondaryLinkClass } from "~/lib/ui";

type Props = {
  title: string;
  /** The private notes of the entry, as the person wrote them. */
  notes: string;
  /** Where the whole entry is, for a link inside the dialog. */
  entryHref: string;
};

/**
 * A notes icon for a library card. Pressing it (a click, a tap, Enter or Space) opens a small
 * panel with the start of the notes, and for a long note a button that opens the whole note in a
 * dialog. It is a native `<details>`, so the panel opens and closes without JavaScript; with
 * JavaScript, Escape and a click outside close it too and the focus goes back to the icon. The
 * dialog is a native `<dialog>`: it keeps the focus inside, scrolls, and Escape closes it. It
 * needs JavaScript to open, and the link to the entry is the way to the whole note without it.
 * The panel does not open on hover: that cannot be done with a finger, opens by accident when the
 * pointer crosses a list, and would have to stay open while the pointer moves onto it.
 */
export function NotesPreview({ title, notes, entryHref }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const icon = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const preview = previewNotes(notes);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      icon.current?.focus();
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

  // A click on the dim area outside the box closes the dialog. It is listened to here and not in
  // the markup: the keyboard already has Escape and the close button.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    function onClick(event: MouseEvent) {
      if (event.target === element) element?.close();
    }
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  }, [preview.truncated]);

  return (
    <>
      <details
        ref={root}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="inline-block align-middle"
      >
        <summary
          ref={icon}
          aria-label={t("library.notes.button", { title })}
          className="border-border text-fg-muted hover:border-accent hover:text-accent focus-visible:outline-accent inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
            <path d="M8 9h8M8 12h5" />
          </svg>
        </summary>
        {/* A card fixed to the bottom of the screen, on a phone and on a desktop: it cannot run
            past an edge, wherever the icon is. */}
        <div
          role="group"
          aria-label={t("library.notes.preview")}
          className="border-border bg-surface-raised text-fg fixed inset-x-4 bottom-4 z-20 mx-auto max-w-sm rounded-md border p-4 text-left text-sm font-normal shadow-lg"
        >
          <p className="break-words whitespace-pre-line">{preview.text}</p>
          {preview.truncated ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                dialog.current?.showModal();
              }}
              className={`${secondaryButtonClass} mt-3`}
            >
              {t("library.notes.full")}
            </button>
          ) : null}
        </div>
      </details>
      {preview.truncated ? (
        <dialog
          ref={dialog}
          aria-labelledby={headingId}
          // The focus was on a button inside the panel, which is now closed: it goes to the icon.
          onClose={() => icon.current?.focus()}
          className="border-border bg-surface text-fg m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-md border p-6 backdrop:bg-black/60"
        >
          <h2 id={headingId} className="text-xl font-semibold">
            {t("library.notes.dialogTitle", { title })}
          </h2>
          <p className="mt-4 break-words whitespace-pre-wrap">{notes}</p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            {/* A plain link: the entry page has its own security policy, which only a new
                document gets. */}
            <a href={entryHref} className={secondaryLinkClass}>
              {t("library.notes.openEntry")}
            </a>
            <form method="dialog">
              <button type="submit" className={secondaryButtonClass}>
                {t("library.notes.close")}
              </button>
            </form>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
