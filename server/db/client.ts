import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * A database client for the Worker. Each query is one HTTPS request to Neon, so it counts
 * against the Worker's limit of 50 subrequests per invocation. A transaction is a list of
 * statements sent together (`db.batch([...])`), with no read in the middle, which is why
 * ids are made in the app or by `uuidv7()` before the batch.
 */
export function createDb(databaseUrl: string) {
  return drizzle({ client: neon(databaseUrl), schema });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
