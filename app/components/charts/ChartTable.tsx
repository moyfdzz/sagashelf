/**
 * The numbers of a chart as a table that opens under it. It is the way to every value for a
 * person who cannot see the colors or cannot point at a mark, and it is plain HTML.
 */
export function ChartTable({
  summary,
  headers,
  rows,
}: {
  summary: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <details className="text-sm">
      <summary className="text-accent hover:text-link-hover focus-visible:outline-accent w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
        {summary}
      </summary>
      <div className="mt-2 max-w-md overflow-x-auto">
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
            {rows.map((row) => (
              <tr key={row[0]} className="border-border border-b last:border-0">
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
