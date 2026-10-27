import { sql } from "drizzle-orm";

import type { ProfileDb } from "./profile";

// Neon (HTTP) and `pg` both answer a raw statement with `{ rows }`; the type of the shared
// database does not say so.
type RawRows = { rows: Record<string, unknown>[] };

// Like the entries (library.ts), every query joins the entry of the person of the session: the id
// of a viewing from the form is never enough to read or change the viewing of another person.

/**
 * The most earlier viewings one entry can hold, so a loop of requests cannot grow it forever. It
 * is checked inside the insert, but two requests that arrive at the same instant can both pass, so
 * it is a soft limit: the write limiter keeps any overshoot to a few rows.
 */
export const maxViewings = 50;

export type Viewing = {
  id: string;
  startedOn: string | null;
  finishedOn: string | null;
  notes: string | null;
};

export type ViewingInput = Omit<Viewing, "id">;

/** The earlier viewings of one entry of this person, the latest first. Empty without an entry. */
export async function listViewings(
  db: ProfileDb,
  userId: string,
  mediaId: string,
): Promise<Viewing[]> {
  const { rows } = (await db.execute(sql`
    SELECT v.id, v.started_on::text AS started_on, v.finished_on::text AS finished_on, v.notes
    FROM library_viewings v
    JOIN library_entries e ON e.id = v.entry_id
    WHERE e.user_id = ${userId}::uuid AND e.media_id = ${mediaId}::uuid
    ORDER BY v.finished_on DESC NULLS LAST, v.started_on DESC NULLS LAST, v.id
  `)) as RawRows;
  return rows.map((row) => ({
    id: String(row.id),
    startedOn: (row.started_on as string | null) ?? null,
    finishedOn: (row.finished_on as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  }));
}

/**
 * Adds an earlier viewing. "missing" when the person has no entry for the title, "limit" when
 * it already holds `maxViewings`.
 */
export async function addViewing(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  input: ViewingInput,
): Promise<"ok" | "missing" | "limit"> {
  const { rows } = (await db.execute(sql`
    WITH entry AS (
      SELECT id FROM library_entries
      WHERE user_id = ${userId}::uuid AND media_id = ${mediaId}::uuid
    ),
    added AS (
      INSERT INTO library_viewings (entry_id, started_on, finished_on, notes)
      SELECT entry.id, ${input.startedOn}::date, ${input.finishedOn}::date, ${input.notes}::text
      FROM entry
      WHERE (SELECT count(*) FROM library_viewings WHERE entry_id = entry.id) < ${maxViewings}
      RETURNING id
    )
    SELECT (SELECT count(*) FROM entry)::int AS found, (SELECT count(*) FROM added)::int AS added
  `)) as RawRows;
  if (Number(rows[0]?.found) === 0) return "missing";
  return Number(rows[0]?.added) > 0 ? "ok" : "limit";
}

/** Changes an earlier viewing of this person. False when there is no such viewing of theirs. */
export async function saveViewing(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  viewingId: string,
  input: ViewingInput,
): Promise<boolean> {
  const { rows } = (await db.execute(sql`
    UPDATE library_viewings v
    SET started_on = ${input.startedOn}::date, finished_on = ${input.finishedOn}::date,
        notes = ${input.notes}::text, updated_at = now()
    FROM library_entries e
    WHERE v.id = ${viewingId}::uuid AND v.entry_id = e.id
      AND e.user_id = ${userId}::uuid AND e.media_id = ${mediaId}::uuid
    RETURNING v.id
  `)) as RawRows;
  return rows.length > 0;
}

/** Removes an earlier viewing of this person. False when there is no such viewing of theirs. */
export async function removeViewing(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  viewingId: string,
): Promise<boolean> {
  const { rows } = (await db.execute(sql`
    DELETE FROM library_viewings v
    USING library_entries e
    WHERE v.id = ${viewingId}::uuid AND v.entry_id = e.id
      AND e.user_id = ${userId}::uuid AND e.media_id = ${mediaId}::uuid
    RETURNING v.id
  `)) as RawRows;
  return rows.length > 0;
}
