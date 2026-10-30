import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { ChartTable } from "~/components/charts/ChartTable";
import { ColumnChart } from "~/components/charts/ColumnChart";
import { HeatMap } from "~/components/charts/HeatMap";
import { ProportionBar } from "~/components/charts/ProportionBar";
import { RowBars } from "~/components/charts/RowBars";

const n = (value: number) => String(value);

// A link needs a router around it.
function render(element: ReactNode): string {
  const router = createMemoryRouter([{ path: "/", element }]);
  return renderToString(<RouterProvider router={router} />);
}

describe("ColumnChart", () => {
  const columns = [
    { key: "1", label: "1", value: 0, title: "1: 0 titles" },
    {
      key: "2",
      label: "2",
      value: 12,
      href: "/library?rated=2",
      title: "2: 12 titles",
    },
    { key: "3", label: "3", value: 3, title: "3: 3 titles" },
  ];

  it("says every value in words, for a screen reader", () => {
    const html = render(<ColumnChart columns={columns} format={n} />);

    expect(html).toContain('aria-label="1: 0, 2: 12, 3: 3"');
  });

  it("is one image when nothing in it is a link, and a group when something is", () => {
    const plain = columns.map((column) => ({ ...column, href: undefined }));

    expect(render(<ColumnChart columns={plain} format={n} />)).toContain(
      'role="img"',
    );
    const linked = render(<ColumnChart columns={columns} format={n} />);
    expect(linked).toContain('role="group"');
    expect(linked).not.toContain('role="img"');
  });

  it("names a link with its whole sentence", () => {
    const html = render(<ColumnChart columns={columns} format={n} />);

    expect(html).toMatch(/<a [^>]*aria-label="2: 12 titles"/);
  });

  it("draws a column for each value above zero, and none for zero", () => {
    const html = render(<ColumnChart columns={columns} format={n} />);

    expect(html.match(/<path /g)).toHaveLength(2);
  });

  it("makes a link only of a column that has an address, with the whole sentence as its hover", () => {
    const html = render(<ColumnChart columns={columns} format={n} />);

    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/library?rated=2"');
    expect(html).toContain("<title>2: 12 titles</title>");
    expect(html).toContain("<title>3: 3 titles</title>");
  });

  it("starts the axis at zero, with round ticks that fit the largest value", () => {
    const html = render(<ColumnChart columns={columns} format={n} />);

    // The largest is 12, so the axis goes to 20.
    expect(html).toContain(">20</text>");
    expect(html).toContain(">10</text>");
    expect(html).toContain(">0</text>");
  });

  it("keeps the last two digits of year labels when there are many", () => {
    const years = Array.from({ length: 10 }, (_, index) => ({
      key: String(2016 + index),
      label: String(2016 + index),
      value: index,
      title: "t",
    }));

    const html = render(<ColumnChart columns={years} format={n} />);

    expect(html).toContain("’16");
    expect(html).not.toContain(">2016<");
  });

  it("keeps short labels whole however many there are", () => {
    const scores = Array.from({ length: 10 }, (_, index) => ({
      key: String(index + 1),
      label: String(index + 1),
      value: 1,
      title: "t",
    }));

    expect(render(<ColumnChart columns={scores} format={n} />)).not.toContain(
      "’",
    );
  });

  it("draws an axis even with nothing in it", () => {
    const html = render(
      <ColumnChart
        columns={[{ key: "a", label: "a", value: 0, title: "a" }]}
        format={n}
      />,
    );

    expect(html).not.toContain("<path ");
    expect(html).not.toContain("NaN");
  });
});

describe("ProportionBar", () => {
  const segments = [
    { key: "a", label: "Anime", value: 3, tone: "chart-1" as const },
    { key: "b", label: "Series", value: 1, tone: "chart-2" as const },
    { key: "c", label: "Libros", value: 0, tone: "chart-3" as const },
  ];

  it("writes each part with its number and its share, and leaves out the empty ones", () => {
    const html = render(
      <ProportionBar
        segments={segments}
        format={n}
        formatShare={(share) => `${share * 100} %`}
      />,
    );

    expect(html).toContain("Anime");
    expect(html).toContain("3 · 75 %");
    expect(html).toContain("1 · 25 %");
    expect(html).not.toContain("Libros");
    expect(html.match(/<rect /g)).toHaveLength(2);
  });

  it("is hidden from a screen reader as a drawing, because the legend says it all", () => {
    const html = render(
      <ProportionBar segments={segments} format={n} formatShare={n} />,
    );

    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain("<title>Anime: 3</title>");
  });

  it("draws nothing for a whole that is empty", () => {
    const html = render(
      <ProportionBar
        segments={[{ key: "a", label: "A", value: 0, tone: "chart-1" }]}
        format={n}
        formatShare={n}
      />,
    );

    expect(html).not.toContain("<rect ");
    expect(html).not.toContain("NaN");
  });
});

describe("RowBars", () => {
  it("writes the number of each row, and links only the rows that have an address", () => {
    const html = render(
      <RowBars
        format={n}
        rows={[
          { key: "a", label: "Pendiente", value: 48, href: "/library" },
          { key: "b", label: "En pausa", value: 3 },
          { key: "c", label: "Abandonado", value: 0 },
        ]}
      />,
    );

    expect(html).toContain("Pendiente");
    expect(html).toContain(">48<");
    expect(html).toContain(">0<");
    expect(html.match(/<a /g)).toHaveLength(1);
    // Two rows have a fill; the empty one has only its track.
    expect(html.match(/class="fill-accent"/g)).toHaveLength(2);
  });

  it("links a row with a plain link that loads a new document, because the library has its own security policy (SAG-86)", () => {
    const html = render(
      <RowBars
        format={n}
        rows={[
          {
            key: "a",
            label: "Acción",
            value: 4,
            href: "/library?genre=action",
          },
        ]}
      />,
    );

    expect(html).toContain('<a href="/library?genre=action"');
    // A client-side link of the router would carry this marker.
    expect(html).not.toContain("data-discover");
  });

  it("measures the bars against the scale it is given, not the longest row", () => {
    const html = render(
      <RowBars
        format={n}
        scaleMax={10}
        rows={[{ key: "a", label: "Series", value: 5 }]}
      />,
    );

    // The track is 300 wide: half the scale is 150, not the full width of the only row.
    expect(html).toMatch(/<rect width="150"[^>]*class="fill-accent"/);
  });
});

describe("HeatMap", () => {
  const cell = (value: number) => ({ value, title: `${value} titles` });
  const months = "EFMAMJJASOND".split("");

  it("shades each cell by how much it has, with its value as the hover", () => {
    const html = render(
      <HeatMap
        months={months}
        less="Less"
        more="More"
        rows={[
          {
            label: "2025",
            cells: [cell(0), cell(1), cell(10), ...Array(9).fill(cell(0))],
          },
        ]}
      />,
    );

    expect(html).toContain("<title>10 titles</title>");
    expect(html).toContain("fill-accent/25");
    expect(html).toContain("2025");
    expect(html).toContain("Less");
  });
});

describe("ChartTable", () => {
  it("is a real table with headers, behind a summary", () => {
    const html = render(
      <ChartTable
        summary="Show the numbers"
        headers={["Score", "Titles"]}
        rows={[
          ["1", "0"],
          ["2", "12"],
        ]}
      />,
    );

    expect(html).toContain("<details");
    expect(html).toContain("Show the numbers");
    expect(html).toContain('scope="col"');
    expect(html).toContain(">12<");
  });

  it("takes a link in a cell, and keeps the first column as text when it is plain (SAG-86)", () => {
    const action = "Action";
    const html = render(
      <ChartTable
        summary="Show the numbers"
        headers={["Genre", "Titles"]}
        rows={[
          [
            <a key="a" href="/library?genre=action">
              {action}
            </a>,
            "4",
          ],
          ["Drama", "3"],
        ]}
      />,
    );

    expect(html).toContain('<a href="/library?genre=action">Action</a>');
    expect(html).toContain(">Drama<");
    expect(html.match(/<tr/g)).toHaveLength(3);
  });

  it("leaves more room for a table with many columns, and keeps the scrolling inside its own box (SAG-86)", () => {
    const base = { summary: "s", headers: ["a", "b"], rows: [["1", "2"]] };

    expect(render(<ChartTable {...base} />)).toContain(
      "overflow-x-auto max-w-md",
    );
    expect(render(<ChartTable {...base} wide />)).toContain(
      "overflow-x-auto max-w-2xl",
    );
  });
});
