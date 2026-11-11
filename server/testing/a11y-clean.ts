import { mkdirSync, rmSync } from "node:fs";

/** Runs once before the whole a11y run, so pages of a test that was deleted or changed are gone. */
export default function setup() {
  const outDir = process.env.A11Y_OUT ?? ".a11y-fragments";
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
}
