import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getEntry, rewatchEntry, saveEntry } from "../server/db/library";
import type { ProfileDb } from "../server/db/profile";
import * as schema from "../server/db/schema";
import type { EntryState } from "../server/library/rules";

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

/**
 * Sets up the entry of a test: writes it on the version it has now, so a test that only needs the
 * state does not have to carry versions around. The tests that are about versions call `saveEntry`
 * with the one they hold. "missing" when the person has no entry.
 */
export async function setEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  next: EntryState,
) {
  const current = await getEntry(db, userId, mediaId, "es");
  if (!current) return "missing" as const;
  return saveEntry(db, userId, mediaId, next, current.version);
}

/** The same for a rewatch: restarts the entry on the version it has now. */
export async function restartEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  next: EntryState,
) {
  const current = await getEntry(db, userId, mediaId, "es");
  if (!current) return "refused" as const;
  return rewatchEntry(db, userId, mediaId, next, current.version);
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
