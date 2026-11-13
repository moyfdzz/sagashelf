/**
 * The small circle with a number that hangs from the corner of a button (SAG-263): the notifications
 * and follow requests that wait for the person. It is drawn over the corner, so it adds no width to
 * the row, and it is hidden from a screen reader because the button says the number in its name.
 * `shown` is already capped ("99+").
 */
export function CountBubble({
  shown,
  className = "",
}: {
  shown: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`bg-accent text-accent-fg border-surface-raised pointer-events-none absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full border-2 px-1 text-xs leading-none font-bold${className ? ` ${className}` : ""}`}
    >
      {shown}
    </span>
  );
}
