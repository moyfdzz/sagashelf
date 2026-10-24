import { sql, type SQL } from "drizzle-orm";

import type { ClerkOperation, RejectReason } from "../auth/clerk-user";
import { erasureCtes } from "./erase-user";

/** What this needs from a database: it runs one SQL statement. Neon (HTTP) and `pg` both fit. */
export type SqlExecutor = {
  execute(query: SQL): PromiseLike<{ rows: Record<string, unknown>[] }>;
};

/**
 * `applied`: the local row changed. `duplicate`: this event id was already handled, nothing
 * was written. `stale`: the event is new but older than what we hold (or the account is
 * deleted), so it was recorded and changed nothing. `rejected`: the account was refused and a
 * follow-up was queued in the outbox. `ignored`: nothing to do for this kind of event.
 */
export type SyncResult =
  "applied" | "duplicate" | "stale" | "rejected" | "ignored";

// One statement per event. A statement is atomic, so the "seen" mark and the change land
// together or not at all, which is the idempotency this endpoint promises. Neon's HTTP driver
// cannot read in the middle of a transaction, so the checks live inside the statement.

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver error and keeps it in `cause`.
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (cause as { code?: string }).code === "23505";
}

function counts(rows: Record<string, unknown>[]) {
  const row = rows[0] ?? {};
  return { fresh: Number(row.fresh ?? 0), written: Number(row.written ?? 0) };
}

async function upsert(
  db: SqlExecutor,
  eventId: string,
  op: Extract<ClerkOperation, { kind: "upsert" }>,
): Promise<SyncResult> {
  const u = op.user;
  const at = u.at.toISOString();
  // `ON CONFLICT (clerk_id)` is the update path. The role, privacy, bio and deleted_at are not
  // in the SET list on purpose: this endpoint never changes them. A row only moves forward in
  // time, and a deleted account is not brought back.
  const { rows } = await db.execute(sql`
    WITH seen AS (
      INSERT INTO processed_webhooks (provider, event_id)
      VALUES ('clerk', ${eventId})
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    written AS (
      INSERT INTO users
        (clerk_id, username, display_name, avatar_url, email_canonical, locale, clerk_updated_at)
      SELECT ${u.clerkId}, ${u.username}, ${u.displayName}, ${u.avatarUrl},
             ${u.emailCanonical}, ${u.locale}, ${at}::timestamptz
      WHERE EXISTS (SELECT 1 FROM seen)
      ON CONFLICT (clerk_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        email_canonical = EXCLUDED.email_canonical,
        clerk_updated_at = EXCLUDED.clerk_updated_at,
        updated_at = now()
      WHERE users.clerk_updated_at < EXCLUDED.clerk_updated_at
        AND users.deleted_at IS NULL
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM seen)::int AS fresh,
           (SELECT count(*) FROM written)::int AS written
  `);
  const { fresh, written } = counts(rows);
  if (fresh === 0) return "duplicate";
  return written > 0 ? "applied" : "stale";
}

async function softDelete(
  db: SqlExecutor,
  eventId: string,
  op: Extract<ClerkOperation, { kind: "delete" }>,
): Promise<SyncResult> {
  // The account is erased whole (see erase-user.ts): what the person made, the profile, and the
  // username and the canonical email, which can be used again. The row stays with its Clerk id
  // so a late update cannot bring it back. A delete wins a tie with an update of the same
  // millisecond. When the person erased the account from their settings first, `target` is
  // empty and this event is only recorded.
  const at = op.at.toISOString();
  const { rows } = await db.execute(sql`
    WITH seen AS (
      INSERT INTO processed_webhooks (provider, event_id)
      VALUES ('clerk', ${eventId})
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    target AS (
      SELECT id FROM users
      WHERE clerk_id = ${op.clerkId}
        AND deleted_at IS NULL
        AND clerk_updated_at <= ${at}::timestamptz
        AND EXISTS (SELECT 1 FROM seen)
    ),
    ${erasureCtes(sql`${at}::timestamptz`)}
    SELECT (SELECT count(*) FROM seen)::int AS fresh,
           (SELECT count(*) FROM written)::int AS written
  `);
  const { fresh, written } = counts(rows);
  if (fresh === 0) return "duplicate";
  return written > 0 ? "applied" : "stale";
}

async function reject(
  db: SqlExecutor,
  eventId: string,
  clerkId: string,
  reason: RejectReason | "taken",
): Promise<SyncResult> {
  // No email or username goes into the payload: only the Clerk id and why. The outbox lets a
  // later job decide what to do with the account (SAG-27); nothing is deleted here.
  const payload = JSON.stringify({ clerkId, reason });
  const { rows } = await db.execute(sql`
    WITH seen AS (
      INSERT INTO processed_webhooks (provider, event_id)
      VALUES ('clerk', ${eventId})
      ON CONFLICT DO NOTHING
      RETURNING 1
    ),
    queued AS (
      INSERT INTO outbox (type, payload, idempotency_key)
      SELECT 'clerk.user_rejected', ${payload}::jsonb, ${`clerk:${eventId}`}
      WHERE EXISTS (SELECT 1 FROM seen)
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM seen)::int AS fresh,
           (SELECT count(*) FROM queued)::int AS written
  `);
  return counts(rows).fresh === 0 ? "duplicate" : "rejected";
}

/**
 * Applies one planned Clerk event. `eventId` is the verified `svix-id`. Repeating the same event
 * changes nothing the second time; an older event never overwrites newer data.
 */
export async function applyClerkOperation(
  db: SqlExecutor,
  eventId: string,
  op: ClerkOperation,
): Promise<SyncResult> {
  switch (op.kind) {
    case "ignore":
      return "ignored";
    case "delete":
      return softDelete(db, eventId, op);
    case "reject":
      return reject(db, eventId, op.clerkId, op.reason);
    case "upsert":
      try {
        return await upsert(db, eventId, op);
      } catch (error) {
        // The username or the canonical email already belongs to another account. The
        // statement was rolled back whole, so record the refusal in a second one.
        if (!isUniqueViolation(error)) throw error;
        return reject(db, eventId, op.user.clerkId, "taken");
      }
  }
}
