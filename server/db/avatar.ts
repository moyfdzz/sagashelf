import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { claimDailyUnit, type DailyClaim } from "./daily-counter";

/** Each try costs a check by the moderation service, which has a monthly limit (ADR-037). */
export const avatarUploadsPerDay = 5;

export type AvatarClaim = DailyClaim;

/**
 * Takes one of the uploads the person has today, before the moderation service is asked. It is one
 * statement that checks the count and adds to it, so requests sent together cannot pass the limit.
 * A try that fails afterwards is not given back: the check was already spent.
 */
export const claimAvatarUpload = (
  db: SqlExecutor,
  userId: string,
): Promise<AvatarClaim> =>
  claimDailyUnit(
    db,
    userId,
    { day: "avatar_uploads_day", count: "avatar_uploads_count" },
    avatarUploadsPerDay,
  );

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
