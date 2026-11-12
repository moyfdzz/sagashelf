import type { Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const assets = "build/client/assets";

/** The CSS of the production build, so the component looks and behaves as it does in the app. */
function appCss(): string {
  const files = existsSync(assets)
    ? readdirSync(assets).filter((name) => name.endsWith(".css"))
    : [];
  if (files.length === 0) {
    throw new Error(
      `No stylesheet in ${assets}: run \`npm run build\` first (the CI does it before the tests).`,
    );
  }
  return files
    .map((name) => readFileSync(join(assets, name), "utf8"))
    .join("\n");
}

/** Draws one component alone, in Spanish, with a button before it and one after it (SAG-251). */
export async function mountComponent(
  page: Page,
  name: "confirm" | "notes" | "account" | "search",
): Promise<void> {
  await page.setContent(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>harness</title><style>${appCss()}</style></head><body><div id="root"></div></body></html>`,
  );
  await page.addScriptTag({
    content: readFileSync(".e2e-harness/harness.js", "utf8"),
  });
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
