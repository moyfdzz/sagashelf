import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The design rules of ADR-033, written as checks. Each rule has a list of the files that still
// break it. The list may only shrink: a new file that breaks a rule fails, and so does a file
// that was fixed but is still listed, so the list is emptied as the tickets land.

const roots = ["app", "server", "workers"];

const isTest = (path: string) =>
  /\.(test|integration\.test)\.tsx?$/.test(path) || path.includes("/testing/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !isTest(path) ? [path] : [];
  });
}

const files = roots.flatMap(sourceFiles);
const read = (path: string) => readFileSync(path, "utf8");

/** Fails for a file that breaks the rule and is not listed, or is listed and no longer breaks it. */
function checkRule(
  breaks: (path: string) => boolean,
  allowed: readonly string[],
) {
  const broken = files.filter(breaks).sort();
  const expected = [...allowed].sort();
  return {
    unlisted: broken.filter((path) => !expected.includes(path)),
    stale: expected.filter((path) => !broken.includes(path)),
  };
}

// SAG-121 removes each of these from the list as it splits the file.
const maxLines = 600;
const longFiles = [
  "app/routes/library.$mediaId.tsx",
  "app/routes/library.tsx",
  "app/routes/stats.tsx",
];

describe("the design rules of ADR-033", () => {
  it("finds the source files it checks", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("app/routes/library.tsx");
  });

  it("keeps a file under 600 lines, apart from the ones listed to be split", () => {
    const result = checkRule(
      (path) => read(path).split("\n").length > maxLines,
      longFiles,
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("does not write a body drain in a route: answerAndDrain does it for every route", () => {
    const result = checkRule(
      (path) =>
        path.startsWith("app/routes/") &&
        /(function|const) answerWithoutReading\b/.test(read(path)),
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it("says what is never cached in one place, server/http/cache.ts, and not in each route", () => {
    const result = checkRule(
      (path) =>
        path !== "server/http/cache.ts" &&
        read(path).includes("private, no-store"),
      [],
    );
    expect(result).toEqual({ unlisted: [], stale: [] });
  });
});
