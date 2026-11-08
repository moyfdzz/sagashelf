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

  // SAG-63 left this open: "if the content jumps sideways when the dialog opens on desktop, decide
  // then". It did (7 px with a 15 px scrollbar, measured in SAG-125), so the room is reserved for
  // the whole app, and a modal that hides the scrollbar no longer moves what is centered.
  it("reserves the space of the scrollbar, so a modal that hides it moves nothing", () => {
    expect(css).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });
});
