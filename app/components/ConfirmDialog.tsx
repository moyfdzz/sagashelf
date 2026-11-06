import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { secondaryLinkClass } from "~/lib/ui";

type Props = {
  title: string;
  message: string;
  /** Where Cancel, Escape and a click outside the box go: back to the page, nothing is sent. */
  cancelHref: string;
  cancelLabel: string;
  /**
   * Something to fill in under the message, such as a note. It sits outside the form of the confirm
   * action, so its fields name that form with the attribute `form`.
   */
  extra?: ReactNode;
  /** The confirm action, a form with its own button. */
  children: ReactNode;
};

/**
 * A confirmation in a modal: a title, a message, Cancel and the confirm action (SAG-125).
 *
 * The page asks for it with an address (`?confirm=...`), so the server draws the dialog already
 * open with a dim layer of its own, and it works without JavaScript: Cancel is a plain link. With
 * JavaScript the dialog is closed and opened again as a real modal, which keeps the focus inside
 * and leaves the page behind inert. Escape and a click outside the box go where Cancel goes, and
 * the focus starts on Cancel, the choice that changes nothing.
 */
export function ConfirmDialog({
  title,
  message,
  cancelHref,
  cancelLabel,
  extra,
  children,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const navigate = useNavigate();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // `showModal` throws on a dialog that is already open, and the server drew it open. The
    // attribute is removed instead of calling `close()`, which would queue a `close` event that the
    // listener below would take for the person closing it.
    element.removeAttribute("open");
    element.showModal();
    element.querySelector<HTMLElement>("[data-cancel]")?.focus();

    // The box has no padding of its own, so a click whose target is the dialog is a click on the
    // dim area around it.
    const onClick = (event: MouseEvent) => {
      if (event.target === element) element.close();
    };
    const onClose = () => void navigate(cancelHref, { replace: true });
    element.addEventListener("click", onClick);
    element.addEventListener("close", onClose);
    return () => {
      element.removeEventListener("click", onClick);
      element.removeEventListener("close", onClose);
      if (element.open) element.close();
    };
  }, [cancelHref, navigate]);

  return (
    <>
      {/* The dim layer for the page without JavaScript; a modal has its own, left transparent. */}
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" />
      <dialog
        ref={dialog}
        open
        aria-labelledby={headingId}
        className="border-border bg-surface text-fg fixed inset-0 z-50 m-auto h-fit max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-md border p-0 shadow-lg backdrop:bg-transparent"
      >
        <div className="space-y-4 p-6">
          <h2 id={headingId} className="text-xl font-semibold break-words">
            {title}
          </h2>
          <p>{message}</p>
          {extra}
          <div className="flex flex-wrap justify-end gap-2">
            {/* A link of the router, so what is being written in the page behind is not lost. */}
            <Link
              data-cancel
              to={cancelHref}
              replace
              preventScrollReset
              className={secondaryLinkClass}
            >
              {cancelLabel}
            </Link>
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
