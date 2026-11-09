import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SAG-196: "a custom title is not shown to others" is written once, as `sharedTitleSql` in
// `server/db/titles.ts`. Seven queries had their own copy of `type <> 'custom'` and one query that
// shows another person's titles had none. This reads the text of everything under `server/` and
// fails on a new copy, and on a reader of another person's titles that does not use the rule.

const serverDir = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "schema" ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** The code of a file without its comments and with the white space collapsed. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ");
}

const sources = sourceFiles(serverDir).map((path) => ({
  path: relative(serverDir, path).replace(/\\/g, "/"),
  code: codeOf(path),
}));

const shared = "db/titles.ts";

// The rule in any spelling: `type <> 'custom'`, `type != 'custom'` or `type = 'custom'`.
const writesTheRule = /\btype\s*(?:<>|!=|=)\s*'custom'/i;

// Readers that show the titles of a person to somebody else.
const showTitlesToOthers = ["db/profile-lists.ts", "db/profile-library.ts"];

describe("the rule for a custom title (SAG-196)", () => {
  it("finds the files it is meant to read", () => {
    const paths = sources.map((file) => file.path);
    for (const path of [shared, ...showTitlesToOthers]) {
      expect(paths).toContain(path);
    }
  });

  it("is written in one place", () => {
    const offenders = sources
      .filter((file) => file.path !== shared && writesTheRule.test(file.code))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("is used by every reader of the titles of another person", () => {
    const missing = sources
      .filter((file) => showTitlesToOthers.includes(file.path))
      .filter((file) => !/\b(?:titleShownSql|sharedTitleSql)\(/.test(file.code))
      .map((file) => file.path);
    expect(missing).toEqual([]);
  });

  it("recognizes the spellings it is meant to catch", () => {
    for (const bad of [
      "WHERE m.type <> 'custom'",
      "WHERE type != 'custom'",
      "AND m.type = 'custom'",
    ]) {
      expect(writesTheRule.test(bad), bad).toBe(true);
    }
    expect(writesTheRule.test("const kind = 'custom';")).toBe(false);
  });
});
