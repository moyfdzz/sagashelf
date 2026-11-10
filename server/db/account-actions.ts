import { sql, type SQL } from "drizzle-orm";

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

/**
 * What an action is about: the person of an open report, or a person named directly (SAG-146), when
 * the administrator saw something that nobody reported. The id of a person comes from the server
 * (`findPersonByUsername`), never from a form.
 */
export type Subject = { reportId: string } | { userId: string };

/**
 * The rows of the subject as the CTE `rep` reads them: the report (null for a direct action), the
 * person, the kind and the state of the account. It is the one place that says who can be acted on:
 * an account that is not erased, and neither an administrator nor the one asking. `state` adds the
 * rule of the action about the states it accepts, and `hiddenGuard` (a warning) refuses a report of
 * a picture that is hidden, which has to be restored or removed first.
 */
function subjectRows(
  actorId: string,
  subject: Subject,
  rules: { state?: SQL; hiddenGuard?: boolean },
): SQL {
  const state = rules.state ?? sql`TRUE`;
  if ("userId" in subject) {
    return sql`
      SELECT NULL::uuid AS report_id, u.id AS target_id, 'user'::text AS kind,
             u.moderation_status AS before
      FROM users u
      WHERE u.id = ${subject.userId}::uuid
        AND u.deleted_at IS NULL AND u.role <> 'admin' AND u.id <> ${actorId}::uuid
        AND ${state}`;
  }
  const guard = rules.hiddenGuard
    ? sql`AND (r.target_type <> 'picture' OR u.hidden_avatar_url IS DISTINCT FROM r.picture_url)`
    : sql``;
  return sql`
    SELECT r.id AS report_id, r.target_id, r.target_type::text AS kind,
           u.moderation_status AS before
    FROM reports r
    JOIN users u ON u.id = r.target_id
    WHERE r.id = ${subject.reportId}::uuid
      AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
      AND r.target_type IN ('picture', 'user')
      AND u.deleted_at IS NULL AND u.role <> 'admin' AND u.id <> ${actorId}::uuid
      ${guard}
      AND ${state}`;
}

/** What the audit row says about the subject: no key for what is empty, and a mark for a direct one. */
const auditMetadata = (extra: SQL, note: string | null): SQL => sql`
  jsonb_strip_nulls(jsonb_build_object(
    'reportId', report_id::text,
    'direct', CASE WHEN report_id IS NULL THEN TRUE END,
    'note', ${note}::text,
    ${extra}
  ))`;

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
 * Tells the person that an administrator found a report about them right, or saw something by
 * themselves. It becomes a notification with the kind and the reason and nothing else, and a report
 * is resolved. Refused while the reported picture is hidden: that one is restored or removed first,
 * or it would stay hidden with no open report. A direct warning is about the person (kind `user`).
 */
export async function warnPerson(
  db: SqlExecutor,
  actorId: string,
  subject: Subject,
  reason: string,
  note: string | null = null,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH rep AS (${subjectRows(actorId, subject, { hiddenGuard: true })}),
    sent AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT target_id, 'moderation.warning',
             jsonb_build_object('kind', kind, 'reason', ${reason}::text),
             'warning:' || COALESCE(report_id::text, gen_random_uuid()::text)
      FROM rep
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    closed AS (
      UPDATE reports SET status = 'resolved', resolved_by = ${actorId}::uuid,
                         resolved_at = now(), updated_at = now()
      WHERE id IN (SELECT report_id FROM rep)
      RETURNING id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'account.warned', 'user', target_id,
             ${auditMetadata(sql`'reason', ${reason}::text`, note)}
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM sent)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/**
 * Suspends or bans the person, after Clerk did. A suspension is only for an active account; a ban
 * also for a suspended one. Every open report about the person is resolved, except one about a
 * picture that is hidden, which stays open to be restored or removed. A ban keeps the level of the
 * profile and puts it at `private`.
 */
export async function restrictAccount(
  db: SqlExecutor,
  actorId: string,
  subject: Subject,
  state: "suspended" | "banned",
  note: string | null = null,
): Promise<boolean> {
  const bans = state === "banned" ? sql`TRUE` : sql`FALSE`;
  const accepts = sql`(u.moderation_status = 'active'
    OR (${bans} AND u.moderation_status = 'suspended'))`;
  const { rows } = await db.execute(sql`
    WITH rep AS (${subjectRows(actorId, subject, { state: accepts })}),
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
             ${auditMetadata(
               sql`'from', before, 'reports', (SELECT count(*) FROM closed)`,
               note,
             )}
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM changed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

export type PersonToAct = {
  userId: string;
  clerkId: string;
  username: string;
  displayName: string | null;
  state: AccountState;
  /** An administrator, or the one asking: nothing is done to them from here. */
  protected: boolean;
};

/**
 * The person of a username, for the direct actions (SAG-146), or null for a name that does not exist
 * or an erased account. The panel is for an administrator, so a private profile is found too.
 */
export async function findPersonByUsername(
  db: SqlExecutor,
  actorId: string,
  username: string,
): Promise<PersonToAct | null> {
  const { rows } = await db.execute(sql`
    SELECT id, clerk_id, username::text AS username, display_name, moderation_status,
           (role = 'admin' OR id = ${actorId}::uuid) AS protected
    FROM users
    WHERE username = ${username} AND deleted_at IS NULL
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: String(row.id),
    clerkId: String(row.clerk_id),
    username: String(row.username),
    displayName: row.display_name === null ? null : String(row.display_name),
    state: asState(row.moderation_status),
    protected: row.protected === true,
  };
}

export type RestrictedAccount = {
  id: string;
  clerkId: string;
  username: string;
  state: Exclude<AccountState, "active">;
  changedAt: Date | null;
  /** The internal note of the last restriction that matches the state, if it had one. */
  note: string | null;
};

/**
 * The accounts that are suspended or banned, the latest first. `offset` skips the pages before
 * (SAG-170); the caller asks for one row more than a page to know whether there is a next one.
 */
export async function listRestrictedAccounts(
  db: SqlExecutor,
  limit: number,
  offset = 0,
): Promise<RestrictedAccount[]> {
  const { rows } = await db.execute(sql`
    SELECT u.id, u.clerk_id, u.username::text AS username, u.moderation_status,
           u.moderation_changed_at, n.note
    FROM users u
    LEFT JOIN LATERAL (
      SELECT a.metadata ->> 'note' AS note
      FROM audit_log a
      WHERE a.target_id = u.id AND a.action = 'account.' || u.moderation_status::text
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 1
    ) n ON TRUE
    WHERE u.moderation_status <> 'active' AND u.deleted_at IS NULL
    ORDER BY u.moderation_changed_at DESC NULLS LAST, u.id
    LIMIT ${limit}::int OFFSET ${offset}::int
  `);
  return rows.map((row) => ({
    id: String(row.id),
    clerkId: String(row.clerk_id),
    username: String(row.username),
    state: row.moderation_status === "banned" ? "banned" : "suspended",
    changedAt: row.moderation_changed_at
      ? new Date(String(row.moderation_changed_at))
      : null,
    note: row.note ? String(row.note) : null,
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
