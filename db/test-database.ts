import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "../server/db/schema";

// The default is the empty `sagashelf_test` database created by `npm run db:up`.
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://sagashelf@127.0.0.1:5432/sagashelf_test";

const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The tests drop and rebuild the whole schema. This refuses anything that is not a local
 * database whose name ends in `_test`, so a wrong variable can never wipe real data.
 * The message never includes the connection string.
 */
export function assertTestDatabase(url: string) {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if (!localHosts.has(parsed.hostname) || !name.endsWith("_test")) {
    throw new Error(
      "Refusing to wipe a database that is not local and named *_test (check TEST_DATABASE_URL)",
    );
  }
}

export function createTestDb() {
  assertTestDatabase(testDatabaseUrl);
  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  return { db: drizzle(pool, { schema }), pool };
}
