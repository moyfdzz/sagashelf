import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SAG-178: "these two people have a block, either way" is written once, as `blockedBetween` in
// `person-visibility.ts`. A statement that reads `blocks` by hand can drift from it, which is how
// SAG-164 and SAG-167 happened. This reads the text of `server/db/` and fails when one does.

const dir = "server/db";
const sources = readdirSync(dir)
  .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
  .map((name) => join(dir, name).replace(/\\/g, "/"))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

// A read of the table, in any spelling: `FROM blocks`, `JOIN blocks`.
const readsBlocks = /\b(from|join)\s+blocks\b/i;

// The shared piece, and the file that lists the rows the viewer blocked (it reads the rows
// themselves, not "is there a block between these two").
const shared = "server/db/person-visibility.ts";
const listsTheRows = "server/db/blocks-mutes.ts";

describe("the check for a block (SAG-178)", () => {
  it("is read in one place, apart from the list of who the viewer blocked", () => {
    const offenders = sources
      .filter((file) => readsBlocks.test(file.text))
      .map((file) => file.path)
      .filter((path) => path !== shared && path !== listsTheRows);
    expect(offenders).toEqual([]);
  });

  it("is not rewritten in the file that lists the rows", () => {
    const text = sources.find((f) => f.path === listsTheRows)?.text ?? "";
    expect(text).toContain("blocks");
    expect(text).not.toMatch(/blocker_id\s*=[^)]*\)\s*OR\s*\(/i);
  });

  it("is defined once, in person-visibility", () => {
    const definers = sources.filter((file) =>
      /export const blockedBetween\b/.test(file.text),
    );
    expect(definers.map((file) => file.path)).toEqual([shared]);
  });
});
