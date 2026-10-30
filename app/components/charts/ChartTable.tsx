import type { ReactNode } from "react";

/**
 * The numbers of a chart as a table that opens under it. It is the way to every value for a
 * person who cannot see the colors or cannot point at a mark, and it is plain HTML.
 */
export function ChartTable({
  summary,
  headers,
  rows,
  wide,
}: {
  summary: string;
  headers: readonly string[];
  /** Room for many columns; the table scrolls inside its own box, never the page. */
  wide?: boolean;
  /** A cell is text, or a link when the row leads somewhere. */
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <details className="text-sm">
      <summary className="text-accent hover:text-link-hover focus-visible:outline-accent w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
        {summary}
      </summary>
      <div
        className={`mt-2 overflow-x-auto ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        <table className="w-full text-left">
          <thead>
            <tr className="border-border border-b">
              {headers.map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={`py-1 pr-4 font-semibold ${index > 0 ? "text-right" : ""}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-border border-b last:border-0"
              >
                {row.map((value, index) => (
                  <td
                    key={index}
                    className={`py-1 pr-4 ${index > 0 ? "text-right tabular-nums" : ""}`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
