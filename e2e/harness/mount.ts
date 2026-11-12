import type { Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";

import type { HarnessName } from "../../app/testing/harness-names";

const assets = "build/client/assets";

let bundle: string | undefined;
let css: string | undefined;

/**
 * Bundles `app/testing/e2e-harness.tsx` for this worker (SAG-251), with the same compiler as the app
 * and no new dependency. It runs once per worker, from `test.beforeAll` of the spec that mounts
 * components, so a run that does not use them pays nothing. Each worker has its own folder, so two
 * of them never write the same file.
 */
export async function prepareHarness(workerIndex: number): Promise<void> {
  const outDir = `.e2e-harness/worker-${workerIndex}`;
  await build({
    configFile: false,
    logLevel: "error",
    resolve: { tsconfigPaths: true },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: "app/testing/e2e-harness.tsx",
        formats: ["iife"],
        name: "SagaHarness",
        fileName: () => "harness.js",
      },
    },
  });
  bundle = readFileSync(join(outDir, "harness.js"), "utf8");
}

/** The CSS of the production build, so the component looks and behaves as it does in the app. */
function appCss(): string {
  if (css === undefined) {
    const files = existsSync(assets)
      ? readdirSync(assets).filter((name) => name.endsWith(".css"))
      : [];
    if (files.length === 0) {
      throw new Error(
        `No stylesheet in ${assets}: run \`npm run build\` first (the CI does it before the tests).`,
      );
    }
    css = files
      .map((name) => readFileSync(join(assets, name), "utf8"))
      .join("\n");
  }
  return css;
}

/** Draws one component alone, in Spanish, with a button before it and one after it (SAG-251). */
export async function mountComponent(
  page: Page,
  name: HarnessName,
): Promise<void> {
  if (bundle === undefined) {
    throw new Error("Call prepareHarness() in test.beforeAll before mounting.");
  }
  await page.setContent(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>harness</title><style>${appCss()}</style></head><body><div id="root"></div></body></html>`,
  );
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async (component) => {
    await (
      window as unknown as { mountHarness: (n: string) => Promise<void> }
    ).mountHarness(component);
    // React draws and runs its effects after the call returns: two frames later the listeners of
    // the component are on, and a key pressed by the test does not beat them.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, name);
}
