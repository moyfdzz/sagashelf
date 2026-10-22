/// <reference types="node" />
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Vitest hands a CSS import back empty, so the file is read as text.
const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

// WCAG contrast of the colors in app/app.css, for the pairs that are used together. If a color
// is changed to something that is hard to read, this fails before anyone has to notice it.

type Oklch = [number, number, number];

function toLinearRgb([lightness, chroma, hueDegrees]: Oklch): number[] {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((value) => Math.min(1, Math.max(0, value)));
}

function luminance(color: Oklch): number {
  const [r = 0, g = 0, b = 0] = toLinearRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: Oklch, second: Oklch): number {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");

function tokens(block: string): Record<string, Oklch> {
  const found: Record<string, Oklch> = {};
  const pattern =
    /--([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  for (const match of block.matchAll(pattern)) {
    found[match[1] ?? ""] = [
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ];
  }
  return found;
}

const themes = {
  light: tokens(css.slice(0, darkStart)),
  dark: { ...tokens(css.slice(0, darkStart)), ...tokens(css.slice(darkStart)) },
};

// [foreground, background, the least that WCAG asks for, what the pair is]
const pairs: [string, string, number, string][] = [
  ["fg", "surface", 7, "text on the page"],
  ["fg-muted", "surface", 4.5, "hints on the page"],
  ["fg-muted", "surface-raised", 4.5, "hints on the navbar and boxes"],
  ["accent", "surface", 4.5, "links and the logo"],
  ["accent", "surface-raised", 4.5, "the logo on the navbar"],
  ["accent-fg", "accent", 4.5, "the text of a button"],
  ["input-edge", "surface", 3, "the edge of a field (non-text contrast)"],
  ["success-fg", "success-bg", 7, "the text of the success message"],
  ["success-edge", "surface", 3, "the edge of the success message"],
  ["danger-fg", "danger-bg", 7, "the text of the error message"],
  ["danger-text", "surface", 4.5, "the error under a field"],
  ["danger-edge", "surface", 3, "the edge of the error message"],
];

describe("palette", () => {
  it("defines every color the pairs use, in both themes", () => {
    for (const theme of Object.values(themes)) {
      for (const [foreground, background] of pairs) {
        expect(theme[foreground], foreground).toBeDefined();
        expect(theme[background], background).toBeDefined();
      }
    }
  });

  for (const [themeName, theme] of Object.entries(themes)) {
    for (const [foreground, background, minimum, what] of pairs) {
      it(`${themeName}: ${what} has at least ${minimum}:1`, () => {
        const first = theme[foreground];
        const second = theme[background];
        if (!first || !second) throw new Error("color not defined");

        expect(contrast(first, second)).toBeGreaterThanOrEqual(minimum);
      });
    }
  }

  it("keeps the dividing line apart from the edge of a field", () => {
    // `--border` only divides and is allowed to be faint; a field must use the stronger one.
    for (const theme of Object.values(themes)) {
      const line = theme["border"];
      const edge = theme["input-edge"];
      const page = theme["surface"];
      if (!line || !edge || !page) throw new Error("color not defined");

      expect(contrast(edge, page)).toBeGreaterThan(contrast(line, page));
    }
  });

  it("would catch a field edge that is too faint", () => {
    // The old value of the field border, used as a control for this very check.
    expect(contrast([0.88, 0.01, 260], [0.99, 0, 0])).toBeLessThan(3);
  });
});
