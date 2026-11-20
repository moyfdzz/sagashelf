import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { text } from "./person";
import { reviewShown, reviewsFrom } from "./reviews";
import { sharedTitleSql } from "./titles";
import type { MyReport } from "./reports";

/**
 * Reports on a review and what the moderation panel does about them (SAG-22, ADR-057). A report of a
 * review keeps its author in `target_id` and the review in `review_id`, like a report of a picture
 * keeps the person and the picture: the author is known after the review is deleted, and every
 * action on a person (warn, suspend, ban) works on it unchanged.
 */

/** The notification the author gets when a moderator removes their review. */
export const reviewRemovedType = "moderation.review_removed";

/** The notification the author gets when a moderator asks them to mark their review as a spoiler. */
export const reviewSpoilerType = "moderation.review_spoiler";

export type ReportableReview = {
  id: string;
  authorId: string;
  author: { username: string; displayName: string | null };
  media: { id: string; type: string; title: string };
};

/**
 * A review the viewer may report: one the title page shows them (`reviewShown`), and not their own.
 * Anything else is null, the same for a review that does not exist and one they may not see.
 */
export async function findReportableReview(
  db: SqlExecutor,
  viewerId: string,
  reviewId: string,
): Promise<ReportableReview | null> {
  const { rows } = await db.execute(sql`
    SELECT r.id, r.user_id, u.username::text AS username, u.display_name,
           m.id AS media_id, m.type::text AS media_type, m.title
    ${reviewsFrom}
    WHERE r.id = ${reviewId}::uuid AND r.user_id <> ${viewerId}::uuid
      AND ${reviewShown(viewerId)}
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    authorId: String(row.user_id),
    author: {
      username: String(row.username),
      displayName: text(row.display_name),
    },
    media: {
      id: String(row.media_id),
      type: String(row.media_type),
      title: String(row.title),
    },
  };
}

/** The open report of this person about this review, or null. Only the reporter reads it. */
export async function findMyReviewReport(
  db: SqlExecutor,
  reporterId: string,
  reviewId: string,
): Promise<MyReport | null> {
  const { rows } = await db.execute(sql`
    SELECT id, reason::text AS reason, status::text AS status
    FROM reports
    WHERE reporter_id = ${reporterId}::uuid
      AND target_type = 'review' AND review_id = ${reviewId}::uuid
      AND cancelled_at IS NULL AND status IN ('open', 'reviewing')
  `);
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        reason: String(row.reason),
        status: String(row.status),
      }
    : null;
}

/**
 * The open report of a review that an action is about, as the CTE `rep`: the report, its review,
 * its author, the title and the reason. The review must still exist and not be removed, and the
 * author must be neither erased, an administrator nor the one asking. `extra` adds the rule of
 * the action.
 */
const reviewReport = (
  actorId: string,
  reportId: string,
  extra: SQL,
): SQL => sql`
  SELECT r.id AS report_id, r.reason::text AS reason, rv.id AS review_id, rv.user_id,
         m.id AS media_id, m.title
  FROM reports r
  JOIN reviews rv ON rv.id = r.review_id AND rv.user_id = r.target_id
  JOIN users u ON u.id = rv.user_id
  JOIN media_items m ON m.id = rv.media_id
  WHERE r.id = ${reportId}::uuid AND r.target_type = 'review'
    AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL
    AND rv.removed_at IS NULL AND ${sharedTitleSql("m")}
    AND u.deleted_at IS NULL AND u.role <> 'admin' AND u.id <> ${actorId}::uuid
    AND ${extra}`;

/** Every open report of the review of `rep`, which one action answers together. */
const openReportsOfReview = sql`
  r.target_type = 'review' AND r.review_id IN (SELECT review_id FROM rep)
  AND r.status IN ('open', 'reviewing') AND r.cancelled_at IS NULL`;

/** The payload of a notification to the author: the title and the reason, never who reported. */
const authorPayload = sql`jsonb_build_object(
  'mediaId', media_id::text, 'title', title, 'reason', reason)`;

/**
 * Removes the review of an open report: it is hidden from everybody but its author and kept as the
 * evidence (`removed_at`). Every open report of that review is resolved, the author is told why,
 * and the audit log says who did it. One statement. Returns false when nothing changed.
 */
export async function removeReview(
  db: SqlExecutor,
  actorId: string,
  reportId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH rep AS (${reviewReport(actorId, reportId, sql`TRUE`)}),
    removed AS (
      UPDATE reviews SET removed_at = now(), updated_at = updated_at
      WHERE id IN (SELECT review_id FROM rep)
      RETURNING id
    ),
    closed AS (
      UPDATE reports r SET status = 'resolved', resolved_by = ${actorId}::uuid,
                           resolved_at = now(), updated_at = now()
      WHERE ${openReportsOfReview}
      RETURNING r.id
    ),
    told AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT user_id, ${reviewRemovedType}, ${authorPayload}, 'review_removed:' || review_id::text
      FROM rep
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'review.removed', 'review', review_id,
             jsonb_build_object('reportId', report_id::text, 'reason', reason,
                                'reports', (SELECT count(*) FROM closed))
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM removed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/**
 * Asks the author of a review with no spoiler mark to add it, instead of removing it (ADR-057). The
 * review records when it was asked, every open report of it waits (`reviewing`) so the panel can
 * see later whether the author did, and the author gets a notification. Only once per review: a
 * second ask while it waits changes nothing.
 */
export async function askSpoilerMark(
  db: SqlExecutor,
  actorId: string,
  reportId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH rep AS (${reviewReport(
      actorId,
      reportId,
      sql`NOT rv.spoiler AND rv.spoiler_requested_at IS NULL`,
    )}),
    asked AS (
      UPDATE reviews SET spoiler_requested_at = now(), updated_at = updated_at
      WHERE id IN (SELECT review_id FROM rep)
      RETURNING id
    ),
    waiting AS (
      UPDATE reports r SET status = 'reviewing', updated_at = now()
      WHERE ${openReportsOfReview}
      RETURNING r.id
    ),
    told AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT user_id, ${reviewSpoilerType}, ${authorPayload}, 'review_spoiler:' || review_id::text
      FROM rep
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'review.spoiler_requested', 'review', review_id,
             jsonb_build_object('reportId', report_id::text)
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM asked)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/**
 * Closes the reports of a review whose author marked it as a spoiler after being asked: every open
 * report of it is resolved and the audit log says so. Refused while the review still has no mark.
 */
export async function closeFixedReview(
  db: SqlExecutor,
  actorId: string,
  reportId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH rep AS (${reviewReport(actorId, reportId, sql`rv.spoiler`)}),
    closed AS (
      UPDATE reports r SET status = 'resolved', resolved_by = ${actorId}::uuid,
                           resolved_at = now(), updated_at = now()
      WHERE ${openReportsOfReview}
      RETURNING r.id
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'review.spoiler_fixed', 'review', review_id,
             jsonb_build_object('reportId', report_id::text, 'reports', (SELECT count(*) FROM closed))
      FROM rep
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM closed)::int AS changed
  `);
  return Number(rows[0]?.changed) >= 1;
}
