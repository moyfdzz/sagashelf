import { heatLevel } from "~/lib/chart-scale";

export type HeatRow = {
  /** The year, or whatever each row is. */
  label: string;
  cells: readonly { value: number; title: string }[];
};

// Five steps of the accent, from the surface to the full color, written whole for the style
// generator.
const levels = [
  "fill-surface-raised",
  "fill-accent/25",
  "fill-accent/45",
  "fill-accent/70",
  "fill-accent",
] as const;

const labelWidth = 34;
const cell = 22;
const gap = 3;
const head = 16;

/**
 * Activity by month as a grid, a row for each year. The darker a cell, the more happened in that
 * month. Each cell says its value on hover; the table beside the chart has all of them.
 */
export function HeatMap({
  rows,
  months,
  less,
  more,
}: {
  rows: readonly HeatRow[];
  /** The short name of each month, January first. */
  months: readonly string[];
  less: string;
  more: string;
}) {
  const max = Math.max(
    0,
    ...rows.flatMap((row) => row.cells.map((c) => c.value)),
  );
  const width = labelWidth + months.length * (cell + gap);
  const height = head + rows.length * (cell + gap);

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-md"
        aria-hidden="true"
      >
        {months.map((month, index) => (
          <text
            key={month}
            x={labelWidth + index * (cell + gap) + cell / 2}
            y={10}
            textAnchor="middle"
            className="fill-fg-muted text-[9px]"
          >
            {month}
          </text>
        ))}
        {rows.map((row, r) => (
          <g key={row.label}>
            <text
              x={0}
              y={head + r * (cell + gap) + cell / 2}
              dominantBaseline="middle"
              className="fill-fg-muted text-[11px]"
            >
              {row.label}
            </text>
            {row.cells.map((c, index) => (
              <rect
                key={index}
                x={labelWidth + index * (cell + gap)}
                y={head + r * (cell + gap)}
                width={cell}
                height={cell}
                rx={4}
                className={`${levels[heatLevel(c.value, max)]} transition-opacity hover:opacity-75 motion-reduce:transition-none`}
              >
                <title>{c.title}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <div
        className="text-fg-muted flex items-center gap-1.5 text-xs"
        aria-hidden="true"
      >
        <span>{less}</span>
        {levels.map((level) => (
          <svg key={level} viewBox="0 0 12 12" className="size-3">
            <rect width={12} height={12} rx={3} className={level} />
          </svg>
        ))}
        <span>{more}</span>
      </div>
    </div>
  );
}
