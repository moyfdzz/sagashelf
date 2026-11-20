// Runs the end-to-end suite on this computer the way CI runs it (SAG-269): the production build,
// `CI=1` and 2 workers, with the owner's `.dev.vars` moved aside so its values never reach the
// build, and put back in a `finally` even when the run fails or is stopped with Ctrl+C.
// Extra arguments go to Playwright: `npm run test:e2e:local -- e2e/navigation.spec.ts`.
// `--a11y` also runs `npm run test:a11y` on the build that the run made.
import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devVars = join(root, ".dev.vars");
const aside = join(root, ".dev.vars.aside");
const builtDevVars = join(root, "build", "server", ".dev.vars");

const args = process.argv.slice(2);
const withA11y = args.includes("--a11y");
const playwrightArgs = args.filter((arg) => arg !== "--a11y");

if (existsSync(aside)) {
  // A run that died before its `finally` (a closed terminal) leaves the file aside.
  if (existsSync(devVars)) {
    console.error(
      "Both .dev.vars and .dev.vars.aside exist. Keep the right one by hand, then run this again.",
    );
    process.exit(1);
  }
  renameSync(aside, devVars);
  console.log("Put back .dev.vars from an earlier run that did not finish.");
}

// Playwright's CLI is started with this same Node, not through `npx` and a shell: an argument
// with spaces (`-g "Escape, a click outside"`) stays one argument, and Ctrl+C does not stop at
// the "Terminate batch job (Y/N)?" prompt of cmd.exe.
const playwrightCli = join(root, "node_modules", "playwright", "cli.js");

function run(command, commandArgs, env, shell = false) {
  return new Promise((done) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell,
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

// Ctrl+C reaches the child too; this process stays alive to put the file back.
process.on("SIGINT", () => {});

let movedAside = false;
let code = 1;
try {
  if (existsSync(devVars)) {
    renameSync(devVars, aside);
    movedAside = true;
  }
  rmSync(builtDevVars, { force: true });
  // With CI set, Playwright starts `npm run preview`, which builds first: the run always tests
  // the code as it is now, never an older build.
  code = await run(
    process.execPath,
    [playwrightCli, "test", "--workers=2", ...playwrightArgs],
    { CI: "1" },
  );
  if (code === 0 && withA11y) {
    code = await run("npm run test:a11y", [], {}, true);
  }
} finally {
  if (movedAside) renameSync(aside, devVars);
}
console.log(
  `\nE2E_LOCAL_EXIT=${code}${movedAside ? " (.dev.vars is back in place)" : ""}`,
);
process.exit(code);
