import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { expect, vi } from "vitest";

/**
 * Setup file of `vitest.a11y.config.ts` only (SAG-249): every page that a test of `app/` draws with
 * `renderToString` is also written as an HTML file, so `scripts/a11y-pages.mjs` can check what the tests already draw,
 * with their synthetic data, with axe. It changes no result.
 */
const outDir = process.env.A11Y_OUT ?? ".a11y-fragments";
mkdirSync(outDir, { recursive: true });

vi.mock("react-dom/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/server")>();
  let count = 0;
  return {
    ...actual,
    renderToString: (...args: Parameters<typeof actual.renderToString>) => {
      const html = actual.renderToString(...args);
      try {
        count += 1;
        const state = expect.getState();
        const file = basename(state.testPath ?? "test").replace(
          /\.test\.tsx?$/,
          "",
        );
        const test = (state.currentTestName ?? "page")
          .replace(/[^a-z0-9]+/gi, "-")
          .slice(0, 80);
        // The file, the test and a hash of the page: two tests with the same title in two files, or
        // two pages of one test, never overwrite each other.
        const hash = createHash("sha1").update(html).digest("hex").slice(0, 8);
        writeFileSync(
          join(outDir, `${file}--${test}-${count}-${hash}.html`),
          html,
        );
      } catch {
        // Writing the file must never fail a test.
      }
      return html;
    },
  };
});
