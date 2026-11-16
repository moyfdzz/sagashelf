import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/** The cheapest statement there is: it proves the database answers, and reads no table (SAG-260). */
export async function pingDatabase(db: SqlExecutor): Promise<void> {
  await db.execute(sql`select 1`);
}
