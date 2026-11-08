import { useState } from "react";

import { StatusToast } from "~/components/StatusToast";

type Props = {
  /** The text of the result, or `null` when there is none to show. */
  message: string | null;
  /**
   * Anything that is a new value for each new result, like the `actionData` of an action or a time
   * stamp. Without it the text itself is used, so the same text twice in a row shows only once.
   */
  messageKey?: unknown;
};

/**
 * Where the result of creating, changing or deleting something appears (SAG-159): a toast over the
 * top of the page that closes by itself. The box is always in the page, even with no message, so a
 * screen reader announces each message that appears in it. Every page that shows a result uses this
 * one and does not write the box again.
 */
export function StatusRegion({ message, messageKey }: Props) {
  const signal = messageKey ?? message;
  // A new signal starts a new toast, so one that was closed shows again.
  const [seen, setSeen] = useState(signal);
  const [shown, setShown] = useState(0);
  if (signal !== seen) {
    setSeen(signal);
    setShown((count) => count + 1);
  }

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-4 top-20 z-50 sm:right-6 sm:left-auto sm:w-96"
    >
      {message ? <StatusToast key={shown}>{message}</StatusToast> : null}
    </div>
  );
}
