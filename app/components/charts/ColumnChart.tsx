import { Link } from "react-router";

import { axisTicks, niceMax } from "~/lib/chart-scale";

export type Column = {
  key: string;
  /** What goes under the column. */
  label: string;
  value: number;
  /** Where pressing the column goes. */
  href?: string;
  /** The whole sentence for the hover, the focus and a screen reader: "6: 12 titles". */
  title: string;
};

// The drawing has its own size and scales with the page, so the text in it is a little smaller on a
// phone. Nothing in it is the only way to a number: the table next to it has all of them.
const width = 360;
const height = 190;
const left = 30;
const right = 4;
const top = 10;
const bottom = 24;
const maxBar = 24;
const radius = 4;

/** A column with the two upper corners rounded and the base square. */
function columnPath(x: number, base: number, w: number, h: number): string {
  const r = Math.min(radius, h, w / 2);
  return `M${x},${base} V${base - h + r} a${r},${r} 0 0 1 ${r},${-r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${base} Z`;
}

/**
 * Values along an ordered axis (the scores 1 to 10, the years) as columns that grow from one
 * baseline. Drawn as SVG by the server, so it needs no script. A column that has a `href` is a link,
 * and each one says its value with the hover and the focus. The labels are cut to two digits when
 * there are many columns, and the table beside the chart has the whole text.
 */
export function ColumnChart({
  columns,
  format,
}: {
  columns: readonly Column[];
  format: (value: number) => string;
}) {
  const max = niceMax(Math.max(0, ...columns.map((column) => column.value)));
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const base = top + plotHeight;
  const slot = plotWidth / Math.max(columns.length, 1);
  const barWidth = Math.min(maxBar, slot - 4);
  // Many labels as long as a year do not fit side by side, so they keep their last two digits.
  const crowded =
    columns.length > 8 && columns.some((column) => column.label.length > 3);
  const y = (value: number) => base - (value / max) * plotHeight;
  // A picture cannot hold links, so a chart with links is a group of them, and the others are
  // one image whose description has every value.
  const linked = columns.some((column) => column.href);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-md"
      role={linked ? "group" : "img"}
      aria-label={columns
        .map((column) => `${column.label}: ${format(column.value)}`)
        .join(", ")}
    >
      {axisTicks(max).map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            x2={width - right}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={left - 6}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-fg-muted text-[11px]"
          >
            {format(tick)}
          </text>
        </g>
      ))}
      {columns.map((column, index) => {
        const x = left + index * slot + (slot - barWidth) / 2;
        const h = (column.value / max) * plotHeight;
        const mark = (
          <>
            <title>{column.title}</title>
            {/* A hit area as wide as the slot and as high as the plot: bigger than the column. */}
            <rect
              x={left + index * slot}
              y={top}
              width={slot}
              height={plotHeight}
              className="fill-transparent"
            />
            {column.value > 0 && (
              <path
                d={columnPath(x, base, barWidth, h)}
                className="fill-accent transition-opacity group-hover:opacity-75 group-focus-visible:opacity-75 motion-reduce:transition-none"
              />
            )}
          </>
        );
        return (
          <g key={column.key}>
            {column.href ? (
              <Link
                to={column.href}
                aria-label={column.title}
                className="group focus-visible:outline-accent outline-offset-[-2px] focus-visible:outline-2"
              >
                {mark}
              </Link>
            ) : (
              <g className="group">{mark}</g>
            )}
            <text
              x={left + index * slot + slot / 2}
              y={height - 8}
              textAnchor="middle"
              className="fill-fg-muted text-[11px]"
              aria-hidden="true"
            >
              {crowded ? `’${column.label.slice(-2)}` : column.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
