import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, vi } from "vitest";

/**
 * Setup file of `vitest.a11y.config.ts` only (SAG-249): every page that a render test draws is
 * also written as an HTML file, so `scripts/a11y-pages.mjs` can check what the tests already draw,
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
        const name = (expect.getState().currentTestName ?? "page")
          .replace(/[^a-z0-9]+/gi, "-")
          .slice(0, 100);
        writeFileSync(join(outDir, `${name}-${count}.html`), html);
      } catch {
        // Writing the file must never fail a test.
      }
      return html;
    },
  };
});
