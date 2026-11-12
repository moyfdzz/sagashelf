// Checks the size budgets of the production build (SAG-250): the gzipped JavaScript and CSS that
// each page loads. It needs no browser and no database, so it gives the same answer every time.
// The routes come from the route manifest that the build writes inside the server bundle; every
// page (a route with a view) needs its own line in `performance-budgets.json`, so a new page makes
// somebody choose its limit.
//
// Usage: node scripts/check-budgets.mjs   (after `npm run build`)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { constants, gzipSync } from "node:zlib";

const serverAssets = "build/server/assets";
const clientDir = "build/client";
const budgets = JSON.parse(readFileSync("performance-budgets.json", "utf8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const bundles = existsSync(serverAssets)
  ? readdirSync(serverAssets).filter((name) =>
      /^server-build-.*\.js$/.test(name),
    )
  : [];
if (bundles.length !== 1) {
  fail(
    `Expected one server bundle in ${serverAssets} and found ${bundles.length}: run \`npm run build\` first.`,
  );
}
const source = readFileSync(join(serverAssets, bundles[0]), "utf8");

const quoted = (text) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const field = (block, name) =>
  new RegExp(String.raw`"${name}":\s*"([^"]*)"`).exec(block)?.[1];
const list = (block, name) =>
  quoted(
    new RegExp(String.raw`"${name}":\s*\[([^\]]*)\]`).exec(block)?.[1] ?? "",
  );

// Every route is one object with no object inside it.
const routes = new Map();
for (const [block] of source.matchAll(/\{[^{}]*"id":\s*"[^"]+"[^{}]*\}/g)) {
  const id = field(block, "id");
  const module = field(block, "module");
  if (!id || !module) continue;
  routes.set(id, {
    parent: field(block, "parentId"),
    module,
    imports: list(block, "imports"),
    css: list(block, "css"),
    hasView: /"hasDefaultExport":\s*true/.test(block),
  });
}
const entry = /"entry":\s*\{[^{}]*\}/.exec(source)?.[0];
if (routes.size < 10 || !entry || !routes.has("root")) {
  fail(
    "The route manifest was not found in the server bundle: the format of the build changed, and this script has to follow it.",
  );
}

const sizes = new Map();
function gzipKb(asset) {
  if (!sizes.has(asset)) {
    const bytes = readFileSync(join(clientDir, asset));
    sizes.set(
      asset,
      gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION }).length / 1024,
    );
  }
  return sizes.get(asset);
}

// What a page loads: the entry, and the route with every route above it (the root, and any layout).
function assetsOf(id) {
  const files = new Set([field(entry, "module"), ...list(entry, "imports")]);
  for (let at = id, hops = 0; at && hops < 10; hops += 1) {
    const route = routes.get(at);
    if (!route) break;
    for (const file of [route.module, ...route.imports, ...route.css]) {
      files.add(file);
    }
    at = route.parent;
  }
  return files;
}
const kb = (files, extension) =>
  [...files]
    .filter((file) => file.endsWith(extension))
    .reduce((sum, file) => sum + gzipKb(file), 0);

const failures = [];
const pages = [...routes].filter(
  ([id, route]) => id !== "root" && route.hasView,
);
if (pages.length === 0) {
  fail(
    "No page with a view was found in the manifest: the format of the build changed.",
  );
}
console.log(`JavaScript each page loads, gzipped (${pages.length} pages):`);
let largestCss = 0;
for (const [id] of pages) {
  const files = assetsOf(id);
  const js = kb(files, ".js");
  largestCss = Math.max(largestCss, kb(files, ".css"));
  const limit = budgets.routes[id];
  if (limit === undefined) {
    failures.push(
      `${id} has no budget (${js.toFixed(1)} KB now): add a line to performance-budgets.json with its size plus 15%`,
    );
    continue;
  }
  const flag = js > limit ? "  OVER" : "";
  console.log(
    `  ${id.padEnd(36)} ${js.toFixed(1).padStart(6)} KB of ${limit}${flag}`,
  );
  if (js > limit) failures.push(`${id}: ${js.toFixed(1)} KB, over ${limit} KB`);
}
const pageIds = new Set(pages.map(([id]) => id));
for (const id of Object.keys(budgets.routes)) {
  if (!pageIds.has(id)) {
    failures.push(
      `${id} has a budget but is not a page of the build: renamed or removed?`,
    );
  }
}

console.log(
  `CSS of the largest page, gzipped: ${largestCss.toFixed(1)} KB of ${budgets.cssKb}`,
);
if (largestCss > budgets.cssKb) {
  failures.push(`CSS: ${largestCss.toFixed(1)} KB, over ${budgets.cssKb} KB`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} budget problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    "\nIf the weight is on purpose, raise the limit in performance-budgets.json in the same PR and say why.",
  );
  process.exit(1);
}
console.log("All budgets met.");
