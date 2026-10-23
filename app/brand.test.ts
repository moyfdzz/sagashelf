import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The logo may use only the colors of the palette "Marino y ámbar" (ADR-013).
const palette = new Set(["#132643", "#025C93", "#F1BA4B", "#E6ECF5"]);

const svg = readFileSync("public/favicon.svg", "utf8");

describe("logo", () => {
  it("uses only colors of the palette", () => {
    const colors = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) =>
      m[0].toUpperCase(),
    );

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) expect(palette.has(color), color).toBe(true);
  });

  it("has no script, inline style or text, so it needs no translation and no CSP exception", () => {
    expect(svg).not.toMatch(/<script|\sstyle=|<text|<foreignObject/i);
  });
});
