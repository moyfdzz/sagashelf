export type Segment = {
  key: string;
  label: string;
  value: number;
  /** The color of the segment and of its key in the legend. */
  tone:
    "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "chart-other";
};

// Written whole, because the style generator only knows the classes it can read in the code.
const fill: Record<Segment["tone"], string> = {
  "chart-1": "fill-chart-1",
  "chart-2": "fill-chart-2",
  "chart-3": "fill-chart-3",
  "chart-4": "fill-chart-4",
  "chart-5": "fill-chart-5",
  "chart-other": "fill-chart-other",
};
const swatch: Record<Segment["tone"], string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
  "chart-other": "bg-chart-other",
};

const width = 300;
const height = 14;
const gap = 2;
const minimum = 3;

/**
 * The parts of a whole as one bar, with a legend that writes each number and share: the colors are
 * never the only way to read it. Parts with nothing in them are left out of the bar and the legend.
 */
export function ProportionBar({
  segments,
  format,
  formatShare,
}: {
  segments: readonly Segment[];
  format: (value: number) => string;
  formatShare: (share: number) => string;
}) {
  const shown = segments.filter((segment) => segment.value > 0);
  const total = shown.reduce((sum, segment) => sum + segment.value, 0);
  const room = width - gap * Math.max(shown.length - 1, 0);
  const widths = shown.map((segment) =>
    Math.max(minimum, (segment.value / total) * room),
  );
  const starts = widths.map((_, index) =>
    widths.slice(0, index).reduce((sum, w) => sum + w + gap, 0),
  );
  const describe = (segment: Segment) =>
    `${segment.label}: ${format(segment.value)}`;
  const countAndShare = (segment: Segment) =>
    `${format(segment.value)} · ${formatShare(segment.value / total)}`;

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-md"
        aria-hidden="true"
      >
        {shown.map((segment, index) => (
          <rect
            key={segment.key}
            x={starts[index]}
            width={widths[index]}
            height={height}
            rx={3}
            className={fill[segment.tone]}
          >
            <title>{describe(segment)}</title>
          </rect>
        ))}
      </svg>
      <ul className="grid max-w-md grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {shown.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`${swatch[segment.tone]} size-2.5 shrink-0 rounded-sm`}
            />
            <span className="text-fg">{segment.label}</span>
            <span className="text-fg-muted ml-auto tabular-nums">
              {countAndShare(segment)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
