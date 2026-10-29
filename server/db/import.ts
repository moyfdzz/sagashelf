import { sql } from "drizzle-orm";

import type { ProfileDb } from "./profile";

// Neon (HTTP) and `pg` both answer a raw statement with `{ rows }`; the type of the shared
// database does not say so.
type RawRows = { rows: Record<string, unknown>[] };

/** A title we already hold, found by its id in its source. */
export type KnownTitle = {
  mediaId: string;
  /** Whether this person already has it in their library. */
  hasEntry: boolean;
  /** Episodes of the title, specials not counted. 0 for a movie. */
  episodes: number;
  /** The kind of title, which decides the units its progress can count. */
  type: string;
};

/**
 * Finds, in one query, the titles of the file that we already hold, by the id of their source
 * (the key is `provider:id`). A title a person made for themselves (`custom`) is never found.
 * `hasEntry` looks only at the entries of `userId`, who comes from the session.
 */
export async function lookupTitles(
  db: ProfileDb,
  userId: string,
  sources: readonly { provider: string; id: string }[],
): Promise<Map<string, KnownTitle>> {
  if (sources.length === 0) return new Map();
  const { rows } = (await db.execute(sql`
    SELECT e.provider::text AS provider, e.external_id, m.id AS media_id, m.type::text AS type,
           EXISTS (
             SELECT 1 FROM library_entries l
             WHERE l.user_id = ${userId}::uuid AND l.media_id = m.id
           ) AS has_entry,
           (
             SELECT count(*)::int FROM media_parts p
             JOIN media_parts s ON s.id = p.parent_id
             WHERE p.media_id = m.id AND p.kind = 'episode' AND s.number > 0
           ) AS episodes
    FROM jsonb_to_recordset(${JSON.stringify(sources)}::jsonb) AS x(provider text, id text)
    JOIN media_external_ids e ON e.provider::text = x.provider AND e.external_id = x.id
    JOIN media_items m ON m.id = e.media_id AND m.type <> 'custom'
  `)) as RawRows;
  return new Map(
    rows.map((row) => [
      `${String(row.provider)}:${String(row.external_id)}`,
      {
        mediaId: String(row.media_id),
        hasEntry: row.has_entry === true,
        episodes: Number(row.episodes),
        type: String(row.type),
      },
    ]),
  );
}

/** One entry ready to be written, after the rules of `normalizeImported`. */
export type EntryToWrite = {
  mediaId: string;
  status: string;
  progress: number;
  progressUnit: "pages" | "chapters" | "volumes" | null;
  progressTotal: number | null;
  score: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
  /** Used only when the entry is new; an existing entry keeps its own. */
  visibility: "public" | "friends" | "private";
  viewings: {
    startedOn: string | null;
    finishedOn: string | null;
    notes: string | null;
  }[];
};

/**
 * Writes the entries of this person with their earlier viewings, in one statement, so a file is
 * imported whole or not at all. A new entry gets the visibility it comes with (the caller passes
 * `private` unless the person asked to keep the file's), and an existing entry keeps the one it
 * has. An entry the person already has stays as it is, unless
 * `replace` is true: then its fields and its viewings are replaced by those of the file.
 * Returns how many entries were added and how many were replaced. `mediaId` must come from
 * `lookupTitles`, never from the file, and must not repeat.
 */
export async function writeEntries(
  db: ProfileDb,
  userId: string,
  entries: readonly EntryToWrite[],
  replace: boolean,
): Promise<{ added: number; replaced: number }> {
  if (entries.length === 0) return { added: 0, replaced: 0 };
  const payload = JSON.stringify(
    entries.map((entry) => ({
      media_id: entry.mediaId,
      status: entry.status,
      progress: entry.progress,
      progress_unit: entry.progressUnit,
      progress_total: entry.progressTotal,
      score: entry.score,
      started_at: entry.startedAt,
      finished_at: entry.finishedAt,
      notes: entry.notes,
      visibility: entry.visibility,
      viewings: entry.viewings.map((viewing) => ({
        started_on: viewing.startedOn,
        finished_on: viewing.finishedOn,
        notes: viewing.notes,
      })),
    })),
  );
  const onConflict = replace
    ? sql`DO UPDATE SET status = EXCLUDED.status, progress = EXCLUDED.progress,
          progress_unit = EXCLUDED.progress_unit, progress_total = EXCLUDED.progress_total,
          score = EXCLUDED.score, started_at = EXCLUDED.started_at,
          finished_at = EXCLUDED.finished_at, notes = EXCLUDED.notes, updated_at = now()`
    : sql`DO NOTHING`;
  const { rows } = (await db.execute(sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        media_id uuid, status text, progress int, progress_unit text, progress_total int,
        score int, started_at date, finished_at date, notes text, visibility text, viewings jsonb
      )
    ),
    written AS (
      INSERT INTO library_entries
        (user_id, media_id, status, progress, progress_unit, progress_total, score, started_at,
         finished_at, notes, visibility)
      SELECT ${userId}::uuid, media_id, status::library_status, progress, progress_unit,
             progress_total, score, started_at, finished_at, notes, visibility::privacy_level
      FROM input
      ON CONFLICT ON CONSTRAINT library_entries_user_media_unique ${onConflict}
      RETURNING id, media_id, (xmax = 0) AS added
    ),
    cleared AS (
      DELETE FROM library_viewings
      WHERE entry_id IN (SELECT id FROM written WHERE NOT added)
      RETURNING 1
    ),
    viewings AS (
      INSERT INTO library_viewings (entry_id, started_on, finished_on, notes)
      SELECT w.id, v.started_on, v.finished_on, v.notes
      FROM written w
      JOIN input i ON i.media_id = w.media_id
      CROSS JOIN LATERAL jsonb_to_recordset(i.viewings)
        AS v(started_on date, finished_on date, notes text)
      RETURNING 1
    )
    SELECT count(*) FILTER (WHERE added)::int AS added,
           count(*) FILTER (WHERE NOT added)::int AS replaced
    FROM written
  `)) as RawRows;
  return {
    added: Number(rows[0]?.added ?? 0),
    replaced: Number(rows[0]?.replaced ?? 0),
  };
}
