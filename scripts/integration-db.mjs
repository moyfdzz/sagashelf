// Makes sure the local Postgres of the integration tests is up before `npm run test:integration`
// (SAG-269). It used to be a list of reminders: start Docker Desktop, run `db:up`, and never from a
// worktree, because Compose names the project after the folder and a worktree started a second,
// empty database. This does the same steps and says which one failed.
// It does nothing in CI or when TEST_DATABASE_URL points somewhere else: CI has its own service.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const host = "127.0.0.1";
const port = 5432;
const dockerDesktop = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

if (process.env.CI || process.env.TEST_DATABASE_URL) process.exit(0);

function portOpen() {
  return new Promise((done) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", () => done(false));
  });
}

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });

// A Docker Desktop that is still starting can leave `docker info` waiting: give each try 10 s.
const dockerAnswers = () =>
  run("docker", ["info"], { timeout: 10_000 }).status === 0;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function waitFor(check, seconds) {
  for (let i = 0; i < seconds; i += 2) {
    if (await check()) return true;
    await sleep(2000);
  }
  return false;
}

if (await portOpen()) process.exit(0);

if (!dockerAnswers()) {
  if (process.platform === "win32" && existsSync(dockerDesktop)) {
    console.log(
      "Docker does not answer: starting Docker Desktop and waiting for it...",
    );
    spawnSync("cmd", ["/c", "start", "", dockerDesktop], { stdio: "ignore" });
    if (!(await waitFor(() => dockerAnswers(), 120))) {
      fail(
        "Docker Desktop did not answer within 2 minutes. Open it by hand and run this again.",
      );
    }
  } else {
    fail("Docker does not answer. Start Docker and run this again.");
  }
}

// Always start the database of the main checkout: from a worktree, Compose would name a new
// project after the worktree folder and start an empty database next to the real one.
const commonDir = run("git", [
  "rev-parse",
  "--path-format=absolute",
  "--git-common-dir",
]);
if (commonDir.status !== 0) fail("Could not find the main checkout with git.");
const mainCheckout = dirname(resolve(commonDir.stdout.trim()));

console.log(
  "Starting the local Postgres (docker compose, from the main checkout)...",
);
const up = run("docker", ["compose", "up", "-d", "--wait", "db"], {
  cwd: mainCheckout,
  stdio: "inherit",
});
if (up.status !== 0) fail("`docker compose up` failed: read its output above.");

if (!(await waitFor(portOpen, 60))) {
  fail(
    `Postgres did not open ${host}:${port} within a minute after the container started.`,
  );
}
