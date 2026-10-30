import { Link } from "react-router";

export type RowBar = {
  key: string;
  label: string;
  value: number;
  /** Where pressing the row goes. */
  href?: string;
};

const width = 300;
const height = 8;

/**
 * Amounts that are compared by length, one row each, in one color: the number is written at the
 * end of every row, so nothing depends on seeing the bar. The longest row fills the width.
 */
export function RowBars({
  rows,
  format,
}: {
  rows: readonly RowBar[];
  format: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul className="max-w-md space-y-2.5">
      {rows.map((row) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg">{row.label}</span>
              <span className="text-fg-muted tabular-nums">
                {format(row.value)}
              </span>
            </span>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="mt-1 block w-full"
              aria-hidden="true"
            >
              <rect
                width={width}
                height={height}
                rx={4}
                className="fill-surface-raised"
              />
              {row.value > 0 && (
                <rect
                  width={Math.max(height, (row.value / max) * width)}
                  height={height}
                  rx={4}
                  className="fill-accent"
                />
              )}
            </svg>
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                to={row.href}
                className="focus-visible:outline-accent hover:text-link-hover block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
