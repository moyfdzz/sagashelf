import { and, eq, isNull } from "drizzle-orm";

import type { SessionUser } from "../auth/authorize";
import type { ProfileDb } from "./profile";
import { users } from "./schema";

/**
 * Our own row for the Clerk id of the verified session, or null when there is none or the account
 * was erased (SAG-166). Erasure keeps the row and the `clerk_id`, so without `deleted_at IS NULL` a
 * second tab or device whose token is still valid would pass as an active account and could write
 * again. An erased account is "no account" for every guard.
 */
export async function findSessionUser(
  db: ProfileDb,
  clerkId: string,
): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      clerkId: users.clerkId,
      role: users.role,
      status: users.moderationStatus,
    })
    .from(users)
    .where(and(eq(users.clerkId, clerkId), isNull(users.deletedAt)))
    .limit(1);
  if (!row) return null;
  const { status, ...user } = row;
  return status === "active" ? user : { ...user, restricted: true };
}
