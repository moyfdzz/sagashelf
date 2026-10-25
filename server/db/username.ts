import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { usernameCooldownDays } from "../account/username-schema";

/** The change was claimed. `previous` is what to put back if Clerk refuses it. */
export type Claim =
  | { ok: true; previous: Date | null }
  | { ok: false; reason: "cooldown" | "gone" };

function asDate(value: unknown): Date | null {
  return value === null || value === undefined
    ? null
    : new Date(value as string | number | Date);
}

/** When the person last changed the username, or null (never, or no active account). */
export async function getUsernameChangedAt(
  db: SqlExecutor,
  userId: string,
): Promise<Date | null> {
  const { rows } = await db.execute(sql`
    SELECT username_changed_at FROM users
    WHERE id = ${userId} AND deleted_at IS NULL
  `);
  return asDate(rows[0]?.username_changed_at);
}

/**
 * Takes the one change the person is allowed every 30 days, before Clerk is asked. It is one
 * statement that checks the date and sets it, so two requests sent together cannot both pass.
 * If Clerk then refuses, `releaseUsernameChange` puts the old date back.
 */
export async function claimUsernameChange(
  db: SqlExecutor,
  userId: string,
): Promise<Claim> {
  const { rows } = await db.execute(sql`
    WITH before AS (
      SELECT id, username_changed_at FROM users
      WHERE id = ${userId} AND deleted_at IS NULL
    ),
    claimed AS (
      UPDATE users SET username_changed_at = now()
      WHERE id IN (SELECT id FROM before)
        AND (
          username_changed_at IS NULL
          OR username_changed_at <= now() - make_interval(days => ${usernameCooldownDays})
        )
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM before)::int AS found,
           (SELECT count(*) FROM claimed)::int AS claimed,
           (SELECT username_changed_at FROM before) AS previous
  `);
  const row = rows[0] ?? {};
  if (Number(row.claimed) === 1) {
    return { ok: true, previous: asDate(row.previous) };
  }
  return { ok: false, reason: Number(row.found) === 0 ? "gone" : "cooldown" };
}

/** Gives the change back after Clerk refused it, so the person may try again. */
export async function releaseUsernameChange(
  db: SqlExecutor,
  userId: string,
  previous: Date | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE users SET username_changed_at = ${previous?.toISOString() ?? null}::timestamptz
    WHERE id = ${userId} AND deleted_at IS NULL
  `);
}

/** True when another account, even a deleted one, already has this name (case does not count). */
export async function isUsernameTaken(
  db: SqlExecutor,
  userId: string,
  username: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    SELECT 1 FROM users WHERE username = ${username} AND id <> ${userId} LIMIT 1
  `);
  return rows.length > 0;
}

/**
 * Writes the new name here as soon as Clerk accepted it, with the time Clerk gave to the change.
 * The `user.updated` event that follows carries that same time, so it finds nothing newer to
 * apply and a late or repeated event cannot undo the change. Nothing happens if a newer event
 * was already applied. Returns false when the row did not change.
 */
export async function applyUsername(
  db: SqlExecutor,
  userId: string,
  username: string,
  clerkUpdatedAt: Date,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE users SET
      username = ${username},
      clerk_updated_at = ${clerkUpdatedAt.toISOString()}::timestamptz,
      updated_at = now()
    WHERE id = ${userId} AND deleted_at IS NULL
      AND clerk_updated_at <= ${clerkUpdatedAt.toISOString()}::timestamptz
    RETURNING 1
  `);
  return rows.length === 1;
}
