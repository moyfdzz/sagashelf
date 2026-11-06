import { sql } from "drizzle-orm";

import {
  contactCreatedType,
  contactRetentionDays,
  dailyMemberCap,
  dailyVisitorCap,
  type ContactKind,
} from "../account/contact-schema";
import type { SqlExecutor } from "./clerk-sync";
import { asDate } from "./dates";

/**
 * The messages of the contact page (SAG-110, ADR-044). Every function is one statement. The text of a
 * message is read only by the administration; the notification and the audit log carry the kind and
 * the ids, never the text.
 */

export type NewContactMessage = {
  /** The signed-in person, or null for a visitor. */
  userId: string | null;
  kind: ContactKind;
  body: string;
  /** Only for a visitor who chose to leave one. */
  replyEmail: string | null;
};

export type ContactOutcome = "sent" | "limit";

/**
 * Stores a message and tells the administrators, in one statement, unless the caller is over the
 * limit of the day: a signed-in person has their own, and visitors share one (they have no id, and
 * the address of a caller is not kept). The ids come from the session, never from the form.
 */
export async function createContactMessage(
  db: SqlExecutor,
  message: NewContactMessage,
): Promise<ContactOutcome> {
  const { userId, kind, body, replyEmail } = message;
  const cap = userId ? dailyMemberCap : dailyVisitorCap;
  const { rows } = await db.execute(sql`
    WITH recent AS (
      SELECT count(*)::int AS made FROM contact_messages
      WHERE created_at > now() - interval '1 day'
        AND user_id IS NOT DISTINCT FROM ${userId}::uuid
    ),
    inserted AS (
      INSERT INTO contact_messages (user_id, kind, body, reply_email)
      SELECT ${userId}::uuid, ${kind}, ${body}, ${replyEmail}
      FROM recent WHERE made < ${cap}::int
      RETURNING id
    ),
    alerted AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT admin.id, ${contactCreatedType}, jsonb_build_object('kind', ${kind}::text),
             'contact:' || inserted.id::text
      FROM inserted CROSS JOIN users admin
      WHERE admin.role = 'admin' AND admin.deleted_at IS NULL
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM inserted)::int AS created
  `);
  return Number(rows[0]?.created) === 1 ? "sent" : "limit";
}

/** How many messages the administration lists. Older ones wait until the cleanup. */
export const contactPageSize = 50;

export type ContactMessageView = {
  id: string;
  kind: string;
  body: string;
  replyEmail: string | null;
  status: "new" | "handled";
  /** The username of a signed-in author, or null for a visitor. */
  username: string | null;
  createdAt: Date;
  handledAt: Date | null;
};

/** The new messages first, then the handled ones, each newest first. For an administrator. */
export async function listContactMessages(
  db: SqlExecutor,
  limit: number = contactPageSize,
): Promise<ContactMessageView[]> {
  const { rows } = await db.execute(sql`
    SELECT m.id, m.kind, m.body, m.reply_email, m.status, u.username::text AS username,
           m.created_at, m.handled_at
    FROM contact_messages m
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY (m.status = 'new') DESC, m.created_at DESC, m.id DESC
    LIMIT ${limit}::int
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    body: String(row.body),
    replyEmail: row.reply_email ? String(row.reply_email) : null,
    status: row.status === "handled" ? "handled" : "new",
    username: row.username ? String(row.username) : null,
    createdAt: asDate(row.created_at),
    handledAt: row.handled_at ? asDate(row.handled_at) : null,
  }));
}

/**
 * Marks a message as handled, or as new again, and writes the audit row, in one statement. False
 * when there is no such message or it is already in that state, so nothing is audited twice.
 */
export async function setContactMessageStatus(
  db: SqlExecutor,
  actorId: string,
  id: string,
  status: "new" | "handled",
): Promise<boolean> {
  const handled = status === "handled" ? sql`TRUE` : sql`FALSE`;
  const action = status === "handled" ? "contact.handled" : "contact.reopened";
  const { rows } = await db.execute(sql`
    WITH changed AS (
      UPDATE contact_messages SET
        status = ${status},
        handled_by = CASE WHEN ${handled} THEN ${actorId}::uuid END,
        handled_at = CASE WHEN ${handled} THEN now() END
      WHERE id = ${id}::uuid AND status <> ${status}
      RETURNING id, kind
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, ${action}, 'contact_message', id, jsonb_build_object('kind', kind)
      FROM changed
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM changed)::int AS changed
  `);
  return Number(rows[0]?.changed) === 1;
}

/** Deletes a message and writes the audit row (kind and id, never the text), in one statement. */
export async function deleteContactMessage(
  db: SqlExecutor,
  actorId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH removed AS (
      DELETE FROM contact_messages WHERE id = ${id}::uuid RETURNING id, kind
    ),
    logged AS (
      INSERT INTO audit_log (actor_id, action, target_type, target_id, metadata)
      SELECT ${actorId}::uuid, 'contact.deleted', 'contact_message', id,
             jsonb_build_object('kind', kind)
      FROM removed
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM removed)::int AS removed
  `);
  return Number(rows[0]?.removed) === 1;
}

/** Deletes what is past its time. It is one statement, in a job of the crons. */
export async function pruneContactMessages(db: SqlExecutor): Promise<number> {
  const { rows } = await db.execute(sql`
    WITH deleted AS (
      DELETE FROM contact_messages
      WHERE created_at < now() - make_interval(days => ${contactRetentionDays}::int)
      RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM deleted
  `);
  return Number(rows[0]?.deleted ?? 0);
}
