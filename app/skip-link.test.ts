import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The root layout draws the whole page, and it needs a router to be drawn in a test, so this reads
// its text (as `status-region.test.ts` does): the skip link is the first thing in the body, before
// the header, and the box that holds the pages is its target (SAG-256). The behavior is tested in
// a real browser by `e2e/skip-link.spec.ts`.
const root = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");

describe("the root layout and the skip link (SAG-256)", () => {
  it("puts the skip link before the header", () => {
    expect(root).toContain("<SkipLink />");
    expect(root.indexOf("<SkipLink />")).toBeLessThan(root.indexOf("<Navbar"));
  });

  it("gives the box of the pages the id of the link, so the focus can go there, and no ring", () => {
    const box = /<div\s+id=\{contentId\}[^>]*>/.exec(root)?.[0] ?? "";

    expect(box).toContain("tabIndex={-1}");
    expect(box).toContain("focus:outline-none");
    expect(root.indexOf(box)).toBeGreaterThan(root.indexOf("<Navbar"));
    expect(root.indexOf(box)).toBeLessThan(root.indexOf("<Footer"));
  });
});
