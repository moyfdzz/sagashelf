import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { assertTestDatabase, testDatabaseUrl } from "./test-database";

// Any number, the same for every run: the key of the advisory lock that one run holds.
const runLockKey = 269_001;

/**
 * Holds a session-level advisory lock for the whole run, so a second run started while one is
 * going fails at once with a clear message. Two runs share the `*_test` database, and the second
 * one used to drop the schema under the first and fail on foreign keys (SAG-269).
 */
async function holdRunLock() {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  // The connection stays open for the whole run; if the database restarts, an `error` with no
  // listener would crash Vitest with an unrelated stack. The tests then fail on their own.
  client.on("error", () => {
    console.error("\nThe connection that holds the run lock was lost.\n");
  });
  await client.connect();
  const { rows } = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [runLockKey],
  );
  if (!rows[0]?.locked) {
    await client.end();
    throw stopRun(
      "Another `npm run test:integration` is using the test database. Wait for it to end.",
    );
  }
  return client;
}

/** Builds the schema from zero with the real migration files, once per test run. */
export async function setup() {
  assertTestDatabase(testDatabaseUrl);
  let lock: pg.Client;
  try {
    lock = await holdRunLock();
  } catch (error) {
    throw unreachable(error);
  }
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } catch (error) {
    await lock.end();
    throw unreachable(error);
  } finally {
    await pool.end();
  }
  return async () => {
    await lock.end();
  };
}

function unreachable(error: unknown) {
  if ((error as { code?: string }).code === "ECONNREFUSED") {
    return stopRun(
      "Cannot reach the test database. Start it with `npm run db:up` (Docker must be running).",
    );
  }
  return error;
}

/**
 * Vitest 5 cannot print an error thrown by a global setup: it fails while mapping the stack and
 * shows "No test files found" with `code.charCodeAt is not a function` instead. So the reason is
 * written first, where the person can read it.
 */
function stopRun(message: string) {
  console.error(`\n${message}\n`);
  return new Error(message);
}
