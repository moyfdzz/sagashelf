import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../server/db/schema";

const { mediaItems, users } = schema;

/** Postgres error codes: 23505 unique, 23503 foreign key, 23514 check. */
export async function failsWith(statement: PromiseLike<unknown>) {
  try {
    await statement;
  } catch (error) {
    // Drizzle wraps the driver error in a DrizzleQueryError and keeps it in `cause`.
    const cause = (error as { cause?: unknown }).cause ?? error;
    const { code, constraint } = cause as {
      code?: string;
      constraint?: string;
    };
    if (code) return { code, constraint };
    throw error;
  }
  throw new Error("Expected the statement to fail, but it succeeded");
}

let counter = 0;

/** Small factories so each test states only what it is about. */
export function factories(db: NodePgDatabase<typeof schema>) {
  async function newUser(overrides: Partial<typeof users.$inferInsert> = {}) {
    counter += 1;
    const [row] = await db
      .insert(users)
      .values({
        clerkId: `clerk_${counter}`,
        username: `person${counter}`,
        emailCanonical: `person${counter}@example.test`,
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("The user was not created");
    return row;
  }

  async function newMedia(
    overrides: Partial<typeof mediaItems.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(mediaItems)
      .values({ type: "movie", title: "Untitled", ...overrides })
      .returning();
    if (!row) throw new Error("The title was not created");
    return row;
  }

  return { newUser, newMedia };
}
