import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SAG-178: "these two people have a block, either way" is written once, as `blockedBetween` in
// `server/db/person-visibility.ts`. A statement that reads `blocks` by hand can drift from it,
// which is how SAG-164 and SAG-167 happened. This reads the text of everything under `server/`
// (raw SQL and Drizzle) and fails when one does. It reads text, not behavior: the integration
// tests of the social graph are what prove the answers.

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

// A read of the table in any spelling: `FROM blocks`, `JOIN "blocks"`, `public.blocks`, a comma
// join and Drizzle's `.from(blocks)` or `.innerJoin(blocks, ...)`.
const table = String.raw`(?:"?public"?\.)?"?blocks"?`;
const readsBlocks = new RegExp(
  String.raw`\b(?:from|join)\s+${table}\b|,\s*${table}\s+[a-z]\b|\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*blocks\b`,
  "i",
);

// "Either way" is a test of the blocker AND the blocked on the two sides of an OR.
const eitherWay =
  /(?:blocker_id|blockerId)[^;]{0,300}\bOR\b[^;]{0,300}(?:blocked_id|blockedId)/i;

const shared = "db/person-visibility.ts";
// They read the rows of one side only (who the viewer blocked), never "is there a block".
const listsTheRows = ["db/blocks-mutes.ts", "account/export.ts"];

describe("the check for a block (SAG-178)", () => {
  it("finds the files it is meant to read", () => {
    const paths = sources.map((file) => file.path);
    for (const path of [shared, ...listsTheRows]) {
      expect(paths).toContain(path);
    }
  });

  it("is read in one place, apart from the lists of who the viewer blocked", () => {
    const offenders = sources
      .filter((file) => readsBlocks.test(file.code))
      .map((file) => file.path)
      .filter((path) => path !== shared && !listsTheRows.includes(path));
    expect(offenders).toEqual([]);
  });

  it("is not written again, in any file but the shared one", () => {
    const offenders = sources
      .filter((file) => file.path !== shared && eitherWay.test(file.code))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("is defined once, in person-visibility", () => {
    const definers = sources.filter((file) =>
      /export const blockedBetween\b/.test(file.code),
    );
    expect(definers.map((file) => file.path)).toEqual([shared]);
  });

  it("recognizes the spellings it is meant to catch", () => {
    for (const bad of [
      "SELECT 1 FROM blocks b",
      'SELECT 1 FROM "blocks" b',
      "SELECT 1 FROM public.blocks b",
      "FROM users u, blocks b WHERE",
      "db.select().from(blocks)",
      "q.innerJoin(blocks, eq(blocks.blockerId, id))",
    ]) {
      expect(readsBlocks.test(bad.replace(/\s+/g, " ")), bad).toBe(true);
    }
    for (const fine of ["const blocks = schemes.flatMap(f)", "blocks.join()"]) {
      expect(readsBlocks.test(fine), fine).toBe(false);
    }
    expect(
      eitherWay.test(
        "(b.blocked_id = x AND b.blocker_id = y) OR (b.blocker_id = y AND b.blocked_id = x)",
      ),
    ).toBe(true);
    expect(
      eitherWay.test(
        "blocker_id = ${a} AND blocked_id IN (SELECT id FROM users)",
      ),
    ).toBe(false);
  });
});
