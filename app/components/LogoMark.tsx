/**
 * The logo for the header: a book with a bookmark. It is drawn with the header's own color
 * names (the book takes the text color, the gap of the spine the header color, the bookmark the
 * brand amber), so it follows the palette in both modes. The name of the site is written next
 * to it, so the drawing is decoration and hidden from screen readers.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="220 200 584 600"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect
        x="230"
        y="310"
        width="564"
        height="480"
        rx="64"
        className="fill-fg"
      />
      <rect
        x="318"
        y="310"
        width="28"
        height="480"
        className="fill-surface-raised"
      />
      <path
        d="M580 220 H706 V600 L643 548 L580 600 Z"
        strokeWidth="20"
        strokeLinejoin="round"
        className="fill-accent stroke-accent"
      />
    </svg>
  );
}
