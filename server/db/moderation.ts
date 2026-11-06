import { sql } from "drizzle-orm";

import { hidingReason } from "../account/report-schema";
import type { SqlExecutor } from "./clerk-sync";

/** How many rows each list of the panel shows. The oldest report comes first, minors before all. */
export const queuePageSize = 50;

/**
 * From this score up, a picture that was allowed is listed for a look, since the service refuses at
 * 0.5 (ADR-037). Like that limit, it was not measured with real pictures.
 */
export const nearLimitFromScore = 0.3;

export type QueueReport = {
  id: string;
  kind: "picture" | "user";
  reason: string;
  details: string | null;
  createdAt: Date;
  username: string;
  /** The picture at the time of the report, for a report of a picture. */
  pictureUrl: string | null;
  /** The picture is out of sight now, so only an administrator can bring it back. */
  hidden: boolean;
  /** The reported picture is still the person's picture. A newer one cannot be judged by this report. */
  current: boolean;
  /** A reviewer must ask to see it. */
  sensitive: boolean;
};

/** The reports nobody has answered, with what the reviewer needs. Never who reported. */
export async function listOpenReports(db: SqlExecutor): Promise<QueueReport[]> {
  const { rows } = await db.execute(sql`
    SELECT r.id, r.target_type::text AS kind, r.reason::text AS reason, r.details,
           r.created_at, u.username::text AS username, r.picture_url,
           (r.target_type = 'picture' AND u.hidden_avatar_url = r.picture_url) AS hidden,
           (r.target_type = 'picture'
             AND (u.avatar_url = r.picture_url OR u.hidden_avatar_url = r.picture_url)) AS current
    FROM reports r
    JOIN users u ON u.id = r.target_id
    WHERE r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
      AND r.target_type IN ('picture', 'user')
    ORDER BY (r.reason = ${hidingReason}::report_reason) DESC, r.created_at ASC
    LIMIT ${queuePageSize}::int
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind === "picture" ? "picture" : "user",
    reason: String(row.reason),
    details: row.details === null ? null : String(row.details),
    createdAt: new Date(String(row.created_at)),
    username: String(row.username),
    pictureUrl: row.picture_url === null ? null : String(row.picture_url),
    hidden: row.hidden === true,
    current: row.current === true,
    sensitive: row.reason === hidingReason,
  }));
}

export type SuspiciousUpload = {
  id: string;
  username: string;
  result: "allowed" | "rejected";
  /** The highest score of the service. */
  score: number;
  createdAt: Date;
};

/**
 * The tries that the service refused, and the ones it allowed with a score close to the limit. The
 * file itself was never kept, so there is nothing to look at: this tells who tried and how often.
 */
export async function listSuspiciousUploads(
  db: SqlExecutor,
): Promise<SuspiciousUpload[]> {
  const { rows } = await db.execute(sql`
    SELECT p.id, u.username::text AS username, p.result, p.created_at,
           COALESCE((SELECT max(s.value::float8) FROM jsonb_each_text(p.scores) AS s), 0) AS score
    FROM picture_uploads p
    JOIN users u ON u.id = p.user_id
    WHERE p.result = 'rejected'
       OR (p.result = 'allowed'
           AND COALESCE((SELECT max(s.value::float8) FROM jsonb_each_text(p.scores) AS s), 0)
               >= ${nearLimitFromScore}::float8)
    ORDER BY p.created_at DESC
    LIMIT ${queuePageSize}::int
  `);
  return rows.map((row) => ({
    id: String(row.id),
    username: String(row.username),
    result: row.result === "rejected" ? "rejected" : "allowed",
    score: Number(row.score),
    createdAt: new Date(String(row.created_at)),
  }));
}

export type ReportToAnswer = {
  id: string;
  clerkId: string;
  /** The reported picture is still the person's, hidden or not. */
  current: boolean;
};

/** What an action needs to know about an open report of a picture, or null for anything else. */
export async function findPictureReport(
  db: SqlExecutor,
  id: string,
): Promise<ReportToAnswer | null> {
  const { rows } = await db.execute(sql`
    SELECT r.id, u.clerk_id,
           (u.avatar_url = r.picture_url OR u.hidden_avatar_url = r.picture_url) AS current
    FROM reports r
    JOIN users u ON u.id = r.target_id
    WHERE r.id = ${id}::uuid AND r.target_type = 'picture'
      AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
      AND u.deleted_at IS NULL
  `);
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        clerkId: String(row.clerk_id),
        current: row.current === true,
      }
    : null;
}

/**
 * Says no problem was found. A report of a picture that is hidden cannot be dismissed, since the
 * picture would stay hidden with nobody looking: it is restored or removed. Every action here is one
 * statement that changes the report and writes the audit entry together, with the administrator of
 * the session. Returns false when nothing changed (answered already, or not allowed).
 */
export async function dismissReport(
  db: SqlExecutor,
  actorId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH done AS (
      UPDATE reports r SET status = 'dismissed', resolved_by = ${actorId}::uuid,
                           resolved_at = now(), updated_at = now()
      FROM users u
      WHERE r.id = ${id}::uuid AND u.id = r.target_id
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND (r.target_type <> 'picture' OR u.hidden_avatar_url IS DISTINCT FROM r.picture_url)
      RETURNING r.id, r.target_type::text AS kind, r.reason::text AS reason
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'report.dismissed', 'report', id,
             jsonb_build_object('kind', kind, 'reason', reason)
      FROM done
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM done)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/**
 * Shows a hidden picture again and closes the reports about it as dismissed. The picture is only
 * brought back while the person has no other one, so a newer picture is never replaced.
 */
export async function restorePicture(
  db: SqlExecutor,
  actorId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH rep AS (
      SELECT r.id, r.target_id, r.picture_url
      FROM reports r
      JOIN users u ON u.id = r.target_id
      WHERE r.id = ${id}::uuid AND r.target_type = 'picture'
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND u.hidden_avatar_url = r.picture_url
    ),
    restored AS (
      UPDATE users SET
        avatar_url = CASE WHEN avatar_url IS NULL THEN hidden_avatar_url ELSE avatar_url END,
        hidden_avatar_url = NULL,
        updated_at = now()
      WHERE id IN (SELECT target_id FROM rep)
      RETURNING id
    ),
    closed AS (
      UPDATE reports r SET status = 'dismissed', resolved_by = ${actorId}::uuid,
                           resolved_at = now(), updated_at = now()
      WHERE r.target_type = 'picture'
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND (r.target_id, r.picture_url) IN (SELECT target_id, picture_url FROM rep)
      RETURNING r.id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'picture.restored', 'user', target_id,
             jsonb_build_object('reportId', id::text, 'reports', (SELECT count(*) FROM closed))
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM restored)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/** What Clerk answered when the picture was deleted there. */
export type ClerkPictureChange = {
  avatarUrl: string | null;
  hasOwnPicture: boolean;
  updatedAt: Date;
};

/**
 * Written after Clerk deleted the picture: the person has the generated image now, the hidden
 * address is forgotten and the reports about this picture are closed as resolved. It follows
 * `applyAvatar`: an event of Clerk newer than this one is not overwritten.
 */
export async function recordPictureRemoved(
  db: SqlExecutor,
  actorId: string,
  id: string,
  change: ClerkPictureChange,
): Promise<boolean> {
  const at = change.updatedAt.toISOString();
  const { rows } = await db.execute(sql`
    WITH rep AS (
      SELECT r.id, r.target_id, r.picture_url
      FROM reports r
      WHERE r.id = ${id}::uuid AND r.target_type = 'picture'
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
    ),
    changed AS (
      UPDATE users SET
        avatar_url = CASE WHEN clerk_updated_at <= ${at}::timestamptz
                          THEN ${change.avatarUrl} ELSE avatar_url END,
        has_own_picture = CASE WHEN clerk_updated_at <= ${at}::timestamptz
                               THEN ${change.hasOwnPicture ? sql`TRUE` : sql`FALSE`}
                               ELSE has_own_picture END,
        hidden_avatar_url = NULL,
        clerk_updated_at = GREATEST(clerk_updated_at, ${at}::timestamptz),
        updated_at = now()
      WHERE id IN (SELECT target_id FROM rep)
      RETURNING id
    ),
    closed AS (
      UPDATE reports r SET status = 'resolved', resolved_by = ${actorId}::uuid,
                           resolved_at = now(), updated_at = now()
      WHERE r.target_type = 'picture'
        AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
        AND (r.target_id, r.picture_url) IN (SELECT target_id, picture_url FROM rep)
      RETURNING r.id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'picture.removed', 'user', target_id,
             jsonb_build_object('reportId', id::text, 'reports', (SELECT count(*) FROM closed))
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM changed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}
