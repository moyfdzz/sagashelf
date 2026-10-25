import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * Every table with a column that points at `users.id` and holds what the person made or
 * follows. `db/erase-user.integration.test.ts` reads the foreign keys of the real database and
 * fails when a table that cascades on a user is missing here, so a new table cannot forget it.
 * [table, column]
 */
export const erasedColumns: readonly (readonly [string, string])[] = [
  ["library_entries", "user_id"],
  ["custom_entries", "owner_id"],
  ["lists", "owner_id"],
  ["webhook_endpoints", "user_id"],
  ["follows", "follower_id"],
  ["follows", "followee_id"],
  ["blocks", "blocker_id"],
  ["blocks", "blocked_id"],
  ["activity", "actor_id"],
  ["likes", "user_id"],
];

/**
 * The common table expressions that erase one account. They read `target`, a CTE the caller
 * defines with the `id` of the account to erase (or no row, when there is nothing to do).
 *
 * What goes: everything the person made or followed, the title of every custom entry (it is
 * text they wrote), and the profile. The username and the canonical email are replaced, so
 * both can be used again. What stays is the row itself, with its id, its Clerk id and the role,
 * marked as deleted: the Clerk id is what stops a late `user.updated` from bringing the
 * account back, and the id keeps the rows that point at it (a report, the audit log) valid.
 * None of that says who the person was.
 *
 * It is one statement, and a statement is atomic: the account is erased whole or not at all.
 */
export function erasureCtes(clerkUpdatedAt: SQL): SQL {
  const deletes = erasedColumns.map(
    ([table, column], index) => sql`
      erase_${sql.raw(String(index))} AS (
        DELETE FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(column)} IN (SELECT id FROM target)
      )`,
  );
  return sql`
    erase_custom_titles AS (
      DELETE FROM media_items
      WHERE id IN (
        SELECT media_id FROM custom_entries WHERE owner_id IN (SELECT id FROM target)
      )
    ),
    ${sql.join(deletes, sql`,`)},
    written AS (
      UPDATE users SET
        deleted_at = now(),
        username = 'deleted-' || substr(replace(id::text, '-', ''), 1, 12),
        email_canonical = 'deleted:' || id::text,
        username_changed_at = NULL,
        display_name = NULL,
        avatar_url = NULL,
        bio = NULL,
        privacy = 'private',
        clerk_updated_at = ${clerkUpdatedAt},
        updated_at = now()
      WHERE id IN (SELECT id FROM target)
      RETURNING 1
    )`;
}

/**
 * Erases the account of `clerkId` now, for the person who asked in their settings. The same
 * erasure runs when Clerk's `user.deleted` event arrives (see clerk-sync.ts); an account that is
 * already erased is left alone, so whichever comes second does nothing.
 * Returns true when this call erased it.
 */
export async function eraseAccount(
  db: SqlExecutor,
  clerkId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH target AS (
      SELECT id FROM users WHERE clerk_id = ${clerkId} AND deleted_at IS NULL
    ),
    ${erasureCtes(sql`now()`)}
    SELECT (SELECT count(*) FROM written)::int AS written
  `);
  return Number(rows[0]?.written ?? 0) > 0;
}
