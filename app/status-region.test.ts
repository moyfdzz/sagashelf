import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The box that holds a toast (a fixed `role="status"` at the top of the page) is written once, in
// `StatusRegion` (SAG-159). A page that needs a result uses the component and does not copy the
// box. This reads the text of the code, so it catches the usual way of copying it.

const component = "app/components/StatusRegion.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
      ? [path]
      : [];
  });
}

const handWrittenBox = /fixed\s+inset-x-4\s+top-20/;
const handWrittenToast = /<StatusToast\b/;

describe("the box of the toasts (SAG-159)", () => {
  it("is written once, in StatusRegion", () => {
    const offenders = sourceFiles("app").filter(
      (path) =>
        path !== component && handWrittenBox.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("is the only place that draws a StatusToast", () => {
    const offenders = sourceFiles("app").filter(
      (path) =>
        path !== component &&
        path !== "app/components/StatusToast.tsx" &&
        handWrittenToast.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises a copy of the box", () => {
    expect(
      handWrittenBox.test(
        '<div role="status" className="pointer-events-none fixed inset-x-4 top-20 z-50">',
      ),
    ).toBe(true);
    expect(handWrittenBox.test('<div role="status" className="mt-4">')).toBe(
      false,
    );
  });
});
