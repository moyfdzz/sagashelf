import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/** Each try costs a check by the moderation service, which has a monthly limit (ADR-037). */
export const avatarUploadsPerDay = 5;

export type AvatarClaim = "ok" | "limit" | "gone";

/**
 * Takes one of the uploads the person has today, before the moderation service is asked. It is one
 * statement that checks the count and adds to it, so requests sent together cannot pass the limit.
 * A try that fails afterwards is not given back: the check was already spent.
 */
export async function claimAvatarUpload(
  db: SqlExecutor,
  userId: string,
): Promise<AvatarClaim> {
  const today = sql`(now() AT TIME ZONE 'utc')::date`;
  const { rows } = await db.execute(sql`
    WITH found AS (
      SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL
    ),
    claimed AS (
      UPDATE users SET
        avatar_uploads_count = CASE
          WHEN avatar_uploads_day = ${today} THEN avatar_uploads_count + 1
          ELSE 1
        END,
        avatar_uploads_day = ${today}
      WHERE id IN (SELECT id FROM found)
        AND (
          avatar_uploads_day IS DISTINCT FROM ${today}
          OR avatar_uploads_count < ${avatarUploadsPerDay}
        )
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM found)::int AS found,
           (SELECT count(*) FROM claimed)::int AS claimed
  `);
  const row = rows[0] ?? {};
  if (Number(row.claimed) === 1) return "ok";
  return Number(row.found) === 0 ? "gone" : "limit";
}

/**
 * Writes the address of the picture here as soon as Clerk changed it, with the time Clerk gave to
 * the change, as `applyUsername` does. The `user.updated` event that follows finds nothing newer to
 * apply, and nothing happens if a newer event was already applied. Returns false when the row did
 * not change.
 */
export async function applyAvatar(
  db: SqlExecutor,
  userId: string,
  avatarUrl: string | null,
  hasOwnPicture: boolean,
  clerkUpdatedAt: Date,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE users SET
      avatar_url = CASE WHEN hidden_avatar_url IS NOT DISTINCT FROM ${avatarUrl}
                        THEN NULL ELSE ${avatarUrl} END,
      has_own_picture = ${hasOwnPicture ? sql`TRUE` : sql`FALSE`},
      clerk_updated_at = ${clerkUpdatedAt.toISOString()}::timestamptz,
      updated_at = now()
    WHERE id = ${userId} AND deleted_at IS NULL
      AND clerk_updated_at <= ${clerkUpdatedAt.toISOString()}::timestamptz
    RETURNING 1
  `);
  return rows.length === 1;
}
