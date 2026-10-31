import { eq } from "drizzle-orm";

import type { ProfileDb } from "./profile";
import { users } from "./schema";
import type { Role } from "../auth/authorize";

/**
 * The role of the account that has this Clerk id, or null when there is none. It is the same
 * column the guards read (`users.role`, ADR-003), so what the header shows and what the server
 * allows come from one place. The id is the one of the verified session, never one from a request.
 */
export async function findRoleByClerkId(
  db: ProfileDb,
  clerkId: string,
): Promise<Role | null> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return row?.role ?? null;
}
