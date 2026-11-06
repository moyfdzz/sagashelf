import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * What an administrator does to a person from the moderation panel (SAG-143, ADR-040): warn, suspend,
 * ban and lift. Like the actions on a picture (`moderation.ts`), each one is one statement that
 * changes the account or the reports and writes its `audit_log` row together, with the administrator
 * of the session. None of them touches an administrator or the administrator's own account, and the
 * ones that are about a report need it open.
 *
 * Suspending and banning are also done in Clerk, which the route does first: Clerk is what stops the
 * sign-in. Here the state is kept, and a ban puts the profile at the level `private`, so every
 * screen hides it with the one policy of ADR-031, and keeps the level it had.
 */

export type AccountState = "active" | "suspended" | "banned";

const asState = (value: unknown): AccountState =>
  value === "suspended" || value === "banned" ? value : "active";

export type ReportedPerson = {
  reportId: string;
  userId: string;
  clerkId: string;
  kind: "picture" | "user";
  reason: string;
  state: AccountState;
  /** An administrator, or the one asking: nothing is done to them from here. */
  protected: boolean;
  /** The reported picture is hidden, so it must be restored or removed before a warning. */
  pictureHidden: boolean;
};

/** The person an open report is about, as the actions need them, or null. */
export async function findReportedPerson(
  db: SqlExecutor,
  actorId: string,
  reportId: string,
): Promise<ReportedPerson | null> {
  const { rows } = await db.execute(sql`
    SELECT r.id, r.target_type::text AS kind, r.reason::text AS reason,
           u.id AS user_id, u.clerk_id, u.moderation_status,
           (u.role = 'admin' OR u.id = ${actorId}::uuid) AS protected,
           (r.target_type = 'picture' AND u.hidden_avatar_url = r.picture_url) AS picture_hidden
    FROM reports r
    JOIN users u ON u.id = r.target_id
    WHERE r.id = ${reportId}::uuid
      AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
      AND r.target_type IN ('picture', 'user')
      AND u.deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    reportId: String(row.id),
    userId: String(row.user_id),
    clerkId: String(row.clerk_id),
    kind: row.kind === "picture" ? "picture" : "user",
    reason: String(row.reason),
    state: asState(row.moderation_status),
    protected: row.protected === true,
    pictureHidden: row.picture_hidden === true,
  };
}

/**
 * Tells the person that a report about them was found right. It becomes a notification with the kind
 * and the reason, and the report is resolved. Refused while the reported picture is hidden: that
 * one is restored or removed first, or it would stay hidden with no open report.
 */
export async function warnPerson(
  db: SqlExecutor,
  actorId: string,
  reportId: string,
  reason: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH rep AS (
      SELECT r.id, r.target_id, r.target_type::text AS kind
      FROM reports r
      JOIN users u ON u.id = r.target_id
      WHERE r.id = ${reportId}::uuid
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND r.target_type IN ('picture', 'user')
        AND u.deleted_at IS NULL AND u.role <> 'admin' AND u.id <> ${actorId}::uuid
        AND (r.target_type <> 'picture' OR u.hidden_avatar_url IS DISTINCT FROM r.picture_url)
    ),
    sent AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT target_id, 'moderation.warning',
             jsonb_build_object('kind', kind, 'reason', ${reason}::text),
             'warning:' || id::text
      FROM rep
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    closed AS (
      UPDATE reports SET status = 'resolved', resolved_by = ${actorId}::uuid,
                         resolved_at = now(), updated_at = now()
      WHERE id IN (SELECT id FROM rep)
      RETURNING id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'account.warned', 'user', target_id,
             jsonb_build_object('reportId', id::text, 'reason', ${reason}::text)
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM closed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/**
 * Suspends or bans the person of an open report, after Clerk did. A suspension is only for an active
 * account; a ban also for a suspended one. Every open report about the person is resolved, except
 * one about a picture that is hidden, which stays open to be restored or removed. A ban keeps the
 * level of the profile and puts it at `private`.
 */
export async function restrictAccount(
  db: SqlExecutor,
  actorId: string,
  reportId: string,
  state: "suspended" | "banned",
): Promise<boolean> {
  const bans = state === "banned" ? sql`TRUE` : sql`FALSE`;
  const { rows } = await db.execute(sql`
    WITH rep AS (
      SELECT r.id, r.target_id, u.moderation_status AS before
      FROM reports r
      JOIN users u ON u.id = r.target_id
      WHERE r.id = ${reportId}::uuid
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND r.target_type IN ('picture', 'user')
        AND u.deleted_at IS NULL AND u.role <> 'admin' AND u.id <> ${actorId}::uuid
        AND (u.moderation_status = 'active'
             OR (${bans} AND u.moderation_status = 'suspended'))
    ),
    changed AS (
      UPDATE users SET
        moderation_status = ${state},
        moderation_changed_at = now(),
        privacy_before_ban = CASE WHEN ${bans} THEN privacy ELSE privacy_before_ban END,
        privacy = CASE WHEN ${bans} THEN 'private'::privacy_level ELSE privacy END,
        updated_at = now()
      WHERE id IN (SELECT target_id FROM rep)
      RETURNING id
    ),
    closed AS (
      UPDATE reports r SET status = 'resolved', resolved_by = ${actorId}::uuid,
                           resolved_at = now(), updated_at = now()
      FROM users u
      WHERE u.id = r.target_id
        AND r.target_id IN (SELECT target_id FROM rep)
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND (r.target_type <> 'picture' OR u.hidden_avatar_url IS DISTINCT FROM r.picture_url)
      RETURNING r.id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'account.' || ${state}::text, 'user', target_id,
             jsonb_build_object('reportId', id::text, 'from', before,
                                'reports', (SELECT count(*) FROM closed))
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM changed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

export type RestrictedAccount = {
  id: string;
  clerkId: string;
  username: string;
  state: Exclude<AccountState, "active">;
  changedAt: Date | null;
};

/** The accounts that are suspended or banned, the latest first. */
export async function listRestrictedAccounts(
  db: SqlExecutor,
  limit: number,
): Promise<RestrictedAccount[]> {
  const { rows } = await db.execute(sql`
    SELECT id, clerk_id, username::text AS username, moderation_status, moderation_changed_at
    FROM users
    WHERE moderation_status <> 'active' AND deleted_at IS NULL
    ORDER BY moderation_changed_at DESC NULLS LAST, id
    LIMIT ${limit}::int
  `);
  return rows.map((row) => ({
    id: String(row.id),
    clerkId: String(row.clerk_id),
    username: String(row.username),
    state: row.moderation_status === "banned" ? "banned" : "suspended",
    changedAt: row.moderation_changed_at
      ? new Date(String(row.moderation_changed_at))
      : null,
  }));
}

/** The account to lift, with its state, or null when it is active, erased or does not exist. */
export async function findRestrictedAccount(
  db: SqlExecutor,
  userId: string,
): Promise<{ clerkId: string; state: "suspended" | "banned" } | null> {
  const { rows } = await db.execute(sql`
    SELECT clerk_id, moderation_status FROM users
    WHERE id = ${userId}::uuid AND moderation_status <> 'active' AND deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    clerkId: String(row.clerk_id),
    state: row.moderation_status === "banned" ? "banned" : "suspended",
  };
}

/** Gives the account back, after Clerk did. A ban gives the profile the level it had. */
export async function liftRestriction(
  db: SqlExecutor,
  actorId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH before AS (
      SELECT id, moderation_status FROM users
      WHERE id = ${userId}::uuid AND moderation_status <> 'active' AND deleted_at IS NULL
    ),
    changed AS (
      UPDATE users SET
        privacy = CASE WHEN moderation_status = 'banned'
                       THEN COALESCE(privacy_before_ban, privacy) ELSE privacy END,
        privacy_before_ban = NULL,
        moderation_status = 'active',
        moderation_changed_at = now(),
        updated_at = now()
      WHERE id IN (SELECT id FROM before)
      RETURNING id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'account.lifted', 'user', id,
             jsonb_build_object('from', moderation_status)
      FROM before
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM changed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}
