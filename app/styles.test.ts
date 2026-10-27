import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest hands a CSS import back empty, so the file is read as text.
const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

describe("the stylesheet", () => {
  it("keeps the page from scrolling while a modal dialog is open", () => {
    expect(css).toMatch(
      /html:has\(dialog\[open\]:modal\)\s*\{[^}]*overflow:\s*hidden/,
    );
  });

  it("does not reserve the space of the scrollbar for the whole app", () => {
    expect(css).not.toContain("scrollbar-gutter");
  });
});
