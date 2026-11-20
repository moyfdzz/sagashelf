// Keeps the `include` list of tsconfig.node.json in step with the code that the Node-side tests
// import. That project is `composite`, so TypeScript refuses (TS6307) any file that a test
// reaches through an import but that the list does not name, and the list used to be kept by
// hand (SAG-269). This walks the relative imports from the roots below and writes the list.
// Run by `npm run typecheck`; with CI set it only checks, and fails when the list is stale.
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "tsconfig.node.json");

// What the Node project is for: the tool configs, the end-to-end tests and the database tests.
const rootFiles = [
  "vite.config.ts",
  "vitest.config.ts",
  "vitest.integration.config.ts",
  "playwright.config.ts",
  "drizzle.config.ts",
];
const rootFolders = ["e2e", "db"];

const toPosix = (path) => path.replace(/\\/g, "/");

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// TypeScript's own scanner finds every import, export-from and dynamic import, and skips
// the word "import" inside comments and strings.
function specifiers(file) {
  return ts
    .preProcessFile(readFileSync(file, "utf8"), true, true)
    .importedFiles.map((entry) => entry.fileName);
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier.replace(/\?.*$/, ""));
  const withoutJs = base.replace(/\.js$/, "");
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return (
    candidates.find((path) => existsSync(path) && statSync(path).isFile()) ??
    null
  );
}

/** Every file reached from the roots through relative imports, outside the root folders. */
export function reachedFiles() {
  const start = [
    ...rootFiles.map((file) => join(root, file)),
    ...rootFolders.flatMap((folder) => sourceFiles(join(root, folder))),
  ];
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!/\.tsx?$/.test(file)) continue;
    for (const specifier of specifiers(file)) {
      const target = resolveImport(file, specifier);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  const insideRoots = (path) =>
    rootFolders.some((folder) => path.startsWith(`${folder}/`)) ||
    rootFiles.includes(path);
  return [...seen]
    .map((path) => toPosix(relative(root, path)))
    .filter((path) => !insideRoots(path) && /\.tsx?$/.test(path))
    .sort();
}

async function main() {
  const current = readFileSync(configPath, "utf8");
  let config;
  try {
    config = JSON.parse(current);
  } catch {
    console.error(
      "tsconfig.node.json must stay plain JSON (no comments, no trailing commas): " +
        "scripts/sync-tsconfig-node.mjs rewrites it. Put the explanation in that script.",
    );
    process.exit(1);
  }
  config.include = [
    ...rootFiles,
    ...rootFolders.map((folder) => `${folder}/**/*`),
    ...reachedFiles(),
  ];
  const options = (await prettier.resolveConfig(configPath)) ?? {};
  const next = await prettier.format(JSON.stringify(config, null, 2), {
    ...options,
    filepath: configPath,
  });
  if (next === current) return;

  const before = new Set(JSON.parse(current).include);
  const after = new Set(config.include);
  const added = [...after].filter((path) => !before.has(path));
  const removed = [...before].filter((path) => !after.has(path));
  const summary = [
    ...added.map((p) => `  + ${p}`),
    ...removed.map((p) => `  - ${p}`),
  ].join("\n");

  if (process.env.CI) {
    console.error(
      `tsconfig.node.json is out of date. Run \`npm run typecheck\` locally and commit it:\n${summary}`,
    );
    process.exit(1);
  }
  writeFileSync(configPath, next);
  console.log(`tsconfig.node.json updated:\n${summary}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
