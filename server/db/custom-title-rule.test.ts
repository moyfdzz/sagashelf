import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SAG-196: "a custom title is not shown to others" is written once, as `sharedTitleSql` in
// `server/db/titles.ts`. Seven queries had their own copy of `type <> 'custom'` and the ones that
// show another person's titles had none. This reads the text of everything under `server/` and
// fails on a new copy, and on a reader of `media_items` that neither uses the rule nor is listed
// here as reading only the data of the person who asked. It reads text, not behavior: the
// integration test of `db/custom-title-rule` is what proves the answers.

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

// The text is not stripped of comments: TypeScript has no safe way to tell `--` or `//` in code
// from a comment with a regex, and a comment that spells the rule out is easy to reword.
const sources = sourceFiles(serverDir).map((path) => ({
  path: relative(serverDir, path).replace(/\\/g, "/"),
  code: readFileSync(path, "utf8").replace(/\s+/g, " "),
}));

const shared = "db/titles.ts";

// The rule in any spelling: `type <> 'custom'`, `type != 'custom'` or `type = 'custom'`.
const writesTheRule = /\btype\s*(?:<>|!=|=)\s*'custom'/i;

// A read of the titles table in any spelling: raw SQL or Drizzle.
const readsTitles = /\bmedia_items\b|\bmediaItems\b/;

// One query that reads the table: `FROM media_items`, `JOIN media_items` or the Drizzle spellings.
const readsOfTitles = (code: string) =>
  [
    ...code.matchAll(
      /\b(?:FROM|JOIN)\s+media_items\b|\.(?:from|(?:inner|left|right|full)?join)\(\s*(?:\w+\.)?mediaItems\b/gi,
    ),
  ].length;

const usesTheRule = (code: string) =>
  [...code.matchAll(/\b(?:titleShownSql|sharedTitleSql)\(/g)].length;

// Readers that show the titles of a person to somebody else, and how many separate queries in each
// must use the rule.
const showTitlesToOthers: Record<string, number> = {
  // The titles of a list and the count of titles of each list.
  "db/profile-lists.ts": 2,
  // The three sections of a profile and one page of a section.
  "db/profile-library.ts": 2,
  // The favorites of the site: the titles counted, and the titles shown.
  "db/site-favorites.ts": 2,
};

// SAG-247: reads of `media_items` that do not use the rule, per file, as they were checked when
// this list was written (the viewer's own rows, a refresh by id, a join already narrowed by a
// query that uses the rule). A new query that reads the table without the rule raises the count
// and fails. Do not raise a number to make the test pass: use the rule, or say in the pull request
// why the new read only touches rows the viewer owns.
const readsWithoutTheRule: Record<string, number> = {
  "db/library.ts": 1,
  "db/list-items.ts": 1,
  "db/recommendations.ts": 1,
};

// Readers of `media_items` that only ever read the data of the person who asked (their library,
// their stats, their alerts, their own export) or erase it. A new file is not added here to make
// the test pass: it uses the rule, or somebody decides it reads only the viewer's own rows.
const ownRowsOnly = [
  "account/export.ts",
  "db/episode-alerts.ts",
  "db/erase-user.ts",
  "db/next-episodes.ts",
  "db/stats.ts",
];

describe("the rule for a custom title (SAG-196)", () => {
  it("finds the files it is meant to read", () => {
    const paths = sources.map((file) => file.path);
    for (const path of [
      shared,
      ...Object.keys(showTitlesToOthers),
      ...ownRowsOnly,
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("is written in one place", () => {
    const offenders = sources
      .filter((file) => file.path !== shared && writesTheRule.test(file.code))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("is used enough times by each reader of the titles of another person", () => {
    const found = Object.fromEntries(
      sources
        .filter((file) => file.path in showTitlesToOthers)
        .map((file) => [file.path, usesTheRule(file.code)]),
    );
    for (const [path, least] of Object.entries(showTitlesToOthers)) {
      expect(found[path], path).toBeGreaterThanOrEqual(least);
    }
  });

  it("is used by every other reader of the titles, unless it reads the viewer's own rows", () => {
    const offenders = sources
      .filter((file) => file.path !== shared && readsTitles.test(file.code))
      .filter((file) => usesTheRule(file.code) === 0)
      .map((file) => file.path)
      .filter((path) => !ownRowsOnly.includes(path));
    expect(offenders).toEqual([]);
  });

  it("has no new query that reads the titles without the rule (SAG-247)", () => {
    const found = Object.fromEntries(
      sources
        .filter(
          (file) => file.path !== shared && !ownRowsOnly.includes(file.path),
        )
        .map((file): [string, number] => [
          file.path,
          Math.max(0, readsOfTitles(file.code) - usesTheRule(file.code)),
        ])
        .filter(([path, count]) => count > 0 || path in readsWithoutTheRule),
    );
    // Every entry of the list must still name a file that has that many reads (a stale or
    // mistyped entry would otherwise leave room for a new unprotected read).
    const expected = readsWithoutTheRule;
    expect(found).toEqual(expected);
  });

  it("recognizes the spellings it is meant to catch", () => {
    for (const bad of [
      "WHERE m.type <> 'custom'",
      "WHERE type != 'custom'",
      "AND m.type = 'custom'",
      "i--; WHERE m.type <> 'custom'",
    ]) {
      expect(writesTheRule.test(bad), bad).toBe(true);
    }
    expect(
      readsOfTitles("FROM media_items m JOIN media_items x .from(mediaItems)"),
    ).toBe(3);
    expect(writesTheRule.test("const kind = 'custom';")).toBe(false);
    for (const read of [
      "FROM media_items m",
      "JOIN media_items m ON",
      ".from(mediaItems)",
    ]) {
      expect(readsTitles.test(read), read).toBe(true);
    }
  });
});
