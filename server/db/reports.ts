import { sql } from "drizzle-orm";

import {
  hidingReason,
  type ReportKind,
  type ReportReason,
} from "../account/report-schema";
import type { SqlExecutor } from "./clerk-sync";

/** More than anybody reports by hand, and it limits how many pictures one account can hide. */
export const dailyReportCap = 20;

/** The type of the notification an administrator gets. The table only allows known ones. */
export const reportCreatedType = "report.created";

export type NewReport = {
  reporterId: string;
  targetId: string;
  kind: ReportKind;
  reason: ReportReason;
  details: string | null;
  /** The picture at the time of the report, for the kind `picture`. */
  pictureUrl: string | null;
};

export type ReportOutcome = "reported" | "duplicate" | "limit";

/**
 * Records a report, tells the administrators and, for a report of minors, stops showing the picture
 * until somebody looks at it. It is one statement, so a report is never recorded without the rest.
 * The picture is only cleared here: it stays in Clerk, and the report keeps its address. A later
 * `user.updated` of Clerk can bring it back, which SAG-143 must close. The ids come from the server.
 */
export async function createReport(
  db: SqlExecutor,
  report: NewReport,
): Promise<ReportOutcome> {
  const { reporterId, targetId, kind, reason, details, pictureUrl } = report;
  const hides = reason === hidingReason ? sql`TRUE` : sql`FALSE`;
  const { rows } = await db.execute(sql`
    WITH recent AS (
      SELECT count(*)::int AS made FROM reports
      WHERE reporter_id = ${reporterId}::uuid AND created_at > now() - interval '1 day'
    ),
    inserted AS (
      INSERT INTO reports (reporter_id, target_type, target_id, reason, details, picture_url)
      SELECT ${reporterId}::uuid, ${kind}::report_target_type, ${targetId}::uuid,
             ${reason}::report_reason, ${details}, ${pictureUrl}
      FROM recent WHERE made < ${dailyReportCap}::int
      ON CONFLICT (reporter_id, target_type, target_id, (coalesce(picture_url, '')))
        WHERE cancelled_at IS NULL
      DO NOTHING
      RETURNING id
    ),
    hidden AS (
      UPDATE users SET avatar_url = NULL
      WHERE ${hides}
        AND id = ${targetId}::uuid
        AND avatar_url = ${pictureUrl}
        AND EXISTS (SELECT 1 FROM inserted)
      RETURNING 1
    ),
    alerted AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT admin.id, ${reportCreatedType},
             jsonb_build_object(
               'kind', ${kind}::text,
               'reason', ${reason}::text,
               'username', (SELECT username::text FROM users WHERE id = ${targetId}::uuid)
             ),
             'report:' || inserted.id::text
      FROM inserted CROSS JOIN users admin
      WHERE admin.role = 'admin' AND admin.deleted_at IS NULL
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM inserted)::int AS created,
           (SELECT made FROM recent) AS made,
           (SELECT count(*) FROM hidden)::int AS hidden,
           (SELECT count(*) FROM alerted)::int AS alerted
  `);
  const row = rows[0] ?? {};
  if (Number(row.created) === 1) return "reported";
  return Number(row.made) >= dailyReportCap ? "limit" : "duplicate";
}

/**
 * Takes back a report of this reporter while nobody has answered it. A report of minors stays: the
 * person sees that before sending it. The row is marked, never deleted, and a picture that was hidden
 * stays hidden. Returns false for anything else, which is also what somebody else's id gets.
 */
export async function cancelReport(
  db: SqlExecutor,
  reporterId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE reports SET cancelled_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
      AND reporter_id = ${reporterId}::uuid
      AND status = 'open'
      AND cancelled_at IS NULL
      AND reason <> ${hidingReason}::report_reason
    RETURNING 1
  `);
  return rows.length === 1;
}

export type MyReport = { id: string; reason: string; status: string };

/**
 * The reports this person has standing about another one: the user, and the picture they have now
 * (a new picture can be reported again). Only the reporter ever reads this, so the reported person
 * cannot see who reported them or how many times.
 */
export async function findMyReports(
  db: SqlExecutor,
  reporterId: string,
  targetId: string,
  pictureUrl: string | null,
): Promise<{ user: MyReport | null; picture: MyReport | null }> {
  const { rows } = await db.execute(sql`
    SELECT id, target_type::text AS target_type, reason::text AS reason, status::text AS status
    FROM reports
    WHERE reporter_id = ${reporterId}::uuid
      AND target_id = ${targetId}::uuid
      AND cancelled_at IS NULL
      AND (
        target_type = 'user'
        OR (target_type = 'picture' AND picture_url = ${pictureUrl})
      )
  `);
  const pick = (type: string): MyReport | null => {
    const row = rows.find((candidate) => candidate.target_type === type);
    return row
      ? {
          id: String(row.id),
          reason: String(row.reason),
          status: String(row.status),
        }
      : null;
  };
  return { user: pick("user"), picture: pick("picture") };
}
