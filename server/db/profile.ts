import { and, eq, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { ProfileUpdate } from "../account/profile-schema";
import * as schema from "./schema";

const { users } = schema;

/** Neon (HTTP) in the Worker and `pg` in the tests both fit: only plain queries are used. */
export type ProfileDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** What the settings page shows and edits. Never the role, the Clerk id or the email. */
export type Profile = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  locale: "es" | "en";
  privacy: "public" | "friends" | "private";
};

const profileColumns = {
  username: users.username,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  bio: users.bio,
  locale: users.locale,
  privacy: users.privacy,
};

// A deleted account has no profile to show or change.
const isActive = (userId: string) =>
  and(eq(users.id, userId), isNull(users.deletedAt));

function asProfile(row: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  locale: string;
  privacy: Profile["privacy"];
}): Profile {
  // The table's check constraint allows only these two languages.
  return { ...row, locale: row.locale === "en" ? "en" : "es" };
}

/** The profile of an active account, or null when it does not exist or was deleted. */
export async function getProfile(
  db: ProfileDb,
  userId: string,
): Promise<Profile | null> {
  const [row] = await db
    .select(profileColumns)
    .from(users)
    .where(isActive(userId))
    .limit(1);
  return row ? asProfile(row) : null;
}

/**
 * Changes only the fields that were sent, on the row of `userId` and nothing else. The id comes
 * from the verified session and never from the request, and the schema that built `update`
 * cannot carry a role, a Clerk id or an email. A field sent as `null` is cleared.
 * Returns the profile after the change, or null when the account does not exist or was deleted.
 */
export async function updateProfile(
  db: ProfileDb,
  userId: string,
  update: ProfileUpdate,
): Promise<Profile | null> {
  const changes: Partial<typeof users.$inferInsert> = {};
  if (update.displayName !== undefined)
    changes.displayName = update.displayName;
  if (update.bio !== undefined) changes.bio = update.bio;
  if (update.locale !== undefined) changes.locale = update.locale;
  if (update.privacy !== undefined) changes.privacy = update.privacy;

  if (Object.keys(changes).length === 0) return getProfile(db, userId);

  const [row] = await db
    .update(users)
    .set(changes)
    .where(isActive(userId))
    .returning(profileColumns);
  return row ? asProfile(row) : null;
}
