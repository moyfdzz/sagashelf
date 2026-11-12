// Checks the size budgets of the production build (SAG-250): the gzipped JavaScript that each page
// loads and the gzipped CSS. It needs no browser and no database, so it gives the same answer
// every time. The sizes of the pages come from the route manifest that the build writes inside
// the server bundle.
//
// Usage: node scripts/check-budgets.mjs   (after `npm run build`)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { constants, gzipSync } from "node:zlib";

const serverAssets = "build/server/assets";
const clientDir = "build/client";
const budgets = JSON.parse(readFileSync("performance-budgets.json", "utf8"));

const bundle = existsSync(serverAssets)
  ? readdirSync(serverAssets).find((name) => /^server-build-.*\.js$/.test(name))
  : undefined;
if (!bundle) {
  console.error(
    `No server bundle in ${serverAssets}: run \`npm run build\` first.`,
  );
  process.exit(1);
}
const source = readFileSync(join(serverAssets, bundle), "utf8");

const quoted = (text) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const routes = new Map();
const routePattern =
  /"id":\s*"([^"]+)",[^{}]*?"module":\s*"([^"]+)",\s*"imports":\s*\[([^\]]*)\],\s*"css":\s*\[([^\]]*)\]/gs;
for (const m of source.matchAll(routePattern)) {
  routes.set(m[1], { module: m[2], imports: quoted(m[3]), css: quoted(m[4]) });
}
const entryMatch =
  /"entry":\s*\{\s*"module":\s*"([^"]+)",\s*"imports":\s*\[([^\]]*)\]/s.exec(
    source,
  );
const root = routes.get("root");
if (routes.size < 10 || !entryMatch || !root) {
  console.error(
    "The route manifest was not found in the server bundle: the format of the build changed, and this script has to follow it.",
  );
  process.exit(1);
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

const shared = new Set([
  entryMatch[1],
  ...quoted(entryMatch[2]),
  root.module,
  ...root.imports,
]);
const scripts = (files) => [...files].filter((file) => file.endsWith(".js"));
const jsKb = (id) => {
  const route = routes.get(id);
  const files = new Set([...shared, route.module, ...route.imports]);
  return scripts(files).reduce((sum, file) => sum + gzipKb(file), 0);
};

const failures = [];
console.log("JavaScript each page loads (gzipped):");
for (const [id, limit] of Object.entries(budgets.routes)) {
  if (!routes.has(id)) {
    failures.push(
      `${id} has a budget but is not in the build: renamed or removed?`,
    );
    continue;
  }
  const size = jsKb(id);
  console.log(
    `  ${id.padEnd(28)} ${size.toFixed(1).padStart(6)} KB of ${limit}`,
  );
  if (size > limit)
    failures.push(`${id}: ${size.toFixed(1)} KB, over ${limit} KB`);
}
// Every other page with a view has the default limit.
for (const id of routes.keys()) {
  if (id === "root" || id in budgets.routes) continue;
  if (
    !/"hasDefaultExport":\s*true/.test(
      source.slice(
        source.indexOf(`"id": "${id}"`),
        source.indexOf(`"id": "${id}"`) + 700,
      ),
    )
  )
    continue;
  const size = jsKb(id);
  if (size > budgets.default) {
    failures.push(
      `${id}: ${size.toFixed(1)} KB, over the default ${budgets.default} KB`,
    );
  }
}

const cssFiles = readdirSync(join(clientDir, "assets")).filter((n) =>
  n.endsWith(".css"),
);
const cssKb = cssFiles.reduce((sum, name) => sum + gzipKb(`assets/${name}`), 0);
console.log(`CSS (gzipped): ${cssKb.toFixed(1)} KB of ${budgets.cssKb}`);
if (cssKb > budgets.cssKb) {
  failures.push(`CSS: ${cssKb.toFixed(1)} KB, over ${budgets.cssKb} KB`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} budget(s) exceeded:`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    "\nIf the weight is on purpose, raise the limit in performance-budgets.json in the same PR and say why.",
  );
  process.exit(1);
}
console.log("All budgets met.");
