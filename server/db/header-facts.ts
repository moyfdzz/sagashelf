import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { unreadCap } from "./notifications";
import { blockedBetween, requesterCardShown } from "./person-visibility";

/**
 * What the header of every page needs to know about the person of the session, read in ONE
 * statement (SAG-114): whether they are an administrator (the link to the administration, SAG-95),
 * their username (the link "Perfil" of the account menu), their picture (SAG-109) and how many
 * things wait for them: the notifications they have not read (SAG-102) plus the follow requests
 * they have not answered (SAG-108). The requests are the ones the list of requests shows: not from
 * an erased account, a hidden or banned person, or somebody blocked either way (SAG-167). Each is
 * counted up to `unreadCap` plus one, so the header can say "99+". Before this there were two reads
 * on every page, one for the role and one for the count.
 */
export type HeaderFacts = {
  isAdmin: boolean;
  username: string;
  avatarUrl: string | null;
  unread: number;
};

/**
 * The facts for the account with this Clerk id (the one of the verified session, never one from a
 * request), or null when there is no account or it was erased. It is a convenience and not a check:
 * the pages of the administration still check the role themselves.
 */
export async function findHeaderFacts(
  db: SqlExecutor,
  clerkId: string,
): Promise<HeaderFacts | null> {
  const { rows } = await db.execute(sql`
    SELECT u.role::text AS role, u.username::text AS username, u.avatar_url,
           (
             SELECT count(*)::int FROM (
               SELECT 1 FROM notifications n
               WHERE n.user_id = u.id AND n.read_at IS NULL
               LIMIT ${unreadCap + 1}::int
             ) capped
           ) + (
             SELECT count(*)::int FROM (
               SELECT 1 FROM follow_requests r
               JOIN users q ON q.id = r.requester_id
               WHERE r.target_id = u.id AND r.declined_at IS NULL
                 AND q.deleted_at IS NULL
                 AND ${requesterCardShown(sql`q.privacy`)}
                 AND NOT ${blockedBetween(sql`u.id`, sql`q.id`)}
               LIMIT ${unreadCap + 1}::int
             ) capped
           ) AS unread
    FROM users u
    WHERE u.clerk_id = ${clerkId} AND u.deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  const avatarUrl = typeof row.avatar_url === "string" ? row.avatar_url : "";
  return {
    isAdmin: row.role === "admin",
    username: String(row.username),
    // The page allows only a picture served over HTTPS.
    avatarUrl: avatarUrl.startsWith("https://") ? avatarUrl : null,
    unread: Number(row.unread ?? 0),
  };
}
