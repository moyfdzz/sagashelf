// Checks with axe the HTML that the render tests draw (SAG-249). The pages that read the database
// cannot be opened by the E2E job (it has no database, and the app talks to Neon over HTTPS), so
// the pages are checked as the render tests draw them, with their synthetic data and the CSS of
// the production build. The page is not hydrated and none of its JavaScript runs, so menus and
// dialogs are not open here, and the language of the page is always set to Spanish.
//
// Usage: node scripts/a11y-pages.mjs   (after `npm run build` and the capture of the render tests)
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const fragments = process.env.A11Y_OUT ?? ".a11y-fragments";
const assets = "build/client/assets";

if (!existsSync(fragments)) {
  console.error(
    `No ${fragments}: run the render tests with vitest.a11y.config.ts first.`,
  );
  process.exit(1);
}
// Every stylesheet of the build, so a second chunk is never left out.
const cssFiles = existsSync(assets)
  ? readdirSync(assets).filter((name) => name.endsWith(".css"))
  : [];
if (cssFiles.length === 0) {
  console.error(`No stylesheet in ${assets}: run \`npm run build\` first.`);
  process.exit(1);
}
const css = cssFiles
  .map((name) => readFileSync(join(assets, name), "utf8"))
  .join("\n");

// Many tests draw the same page; each distinct one is checked once.
const pages = new Map();
for (const name of readdirSync(fragments).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(fragments, name), "utf8");
  const hash = createHash("sha1").update(html).digest("hex");
  if (!pages.has(hash)) pages.set(hash, { name, html });
}
if (pages.size === 0) {
  console.error(
    "No page was captured: the check would pass without checking anything.",
  );
  process.exit(1);
}

// A phone, in the two themes. Reduced motion, so the toast is not measured half way through its
// fade (that read as a contrast of 1.3 that no person sees).
const configs = [
  { name: "320 px, light", width: 320, colorScheme: "light" },
  { name: "320 px, dark", width: 320, colorScheme: "dark" },
];
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const queue = [...pages.values()];
/** @type {{ page: string; config: string; rule: string; target: string }[]} */
const failures = [];
let checked = 0;

const browser = await chromium.launch();
async function checkPage(page, next) {
  for (const config of configs) {
    await page.setViewportSize({ width: config.width, height: 900 });
    await page.emulateMedia({ colorScheme: config.colorScheme });
    await page.setContent(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>a11y</title><style>${css}</style></head><body>${next.html}</body></html>`,
    );
    const result = await new AxeBuilder({ page }).withTags(tags).analyze();
    checked += 1;
    for (const violation of result.violations) {
      for (const node of violation.nodes.slice(0, 3)) {
        failures.push({
          page: next.name,
          config: config.name,
          rule: violation.id,
          target: node.target.join(" "),
        });
      }
    }
  }
}

async function worker() {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  for (let next = queue.pop(); next; next = queue.pop()) {
    try {
      await checkPage(page, next);
    } catch (error) {
      // A page that cannot be checked is a failure with its name, not a crash of the whole run.
      failures.push({
        page: next.name,
        config: "any",
        rule: "could-not-check",
        target: String(error).slice(0, 200),
      });
    }
  }
  await context.close();
}

try {
  await Promise.all([worker(), worker(), worker(), worker()]);
} finally {
  await browser.close();
}

console.log(`${pages.size} pages, ${checked} checks.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} accessibility violation(s):`);
  for (const f of failures) {
    console.error(`- [${f.rule}] ${f.page} (${f.config}): ${f.target}`);
  }
  process.exit(1);
}
console.log("No accessibility violations.");
