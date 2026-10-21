import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { assertTestDatabase, testDatabaseUrl } from "./test-database";

/** Builds the schema from zero with the real migration files, once per test run. */
export async function setup() {
  assertTestDatabase(testDatabaseUrl);
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } catch (error) {
    if ((error as { code?: string }).code === "ECONNREFUSED") {
      throw new Error(
        "Cannot reach the test database. Start it with `npm run db:up` (Docker must be running).",
      );
    }
    throw error;
  } finally {
    await pool.end();
  }
}
