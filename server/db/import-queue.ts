import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";

/**
 * The queue of the titles of an import that only a provider knows (SAG-241, ADR-047). Every function
 * is one statement. A person's id always comes from the session or from a row of the queue, never
 * from a file.
 */

// Neon (HTTP) and `pg` both answer a raw statement with `{ rows }`.
type RawRows = { rows: Record<string, unknown>[] };

/** Why a title was left out, shown to the person. Each has its text under settings.import.reasons. */
export type QueueSkipReason =
  | "invalid"
  | "no_source"
  | "duplicate"
  | "unsupported_provider"
  | "not_found"
  | "failed";

/** A title that waits for its turn, with the entry to write once it is saved. */
export type PendingRow = { position: number; title: string; entry: unknown };
export type SkippedRow = {
  position: number;
  title: string;
  reason: QueueSkipReason;
};

export type NewImportJob = {
  replace: boolean;
  keepVisibility: boolean;
  locale: "es" | "en";
  total: number;
  /** What the upload already wrote, for the summary. */
  written: { added: number; replaced: number; kept: number };
  pending: readonly PendingRow[];
  skipped: readonly SkippedRow[];
};

/** Rows a run takes, and the people they may belong to: the bound of the subrequests (ADR-047). */
export const rowsPerRun = 5;
export const rowsPerPersonPerRun = 3;
export const peoplePerRun = 2;
/** Times a provider may not answer for a title before it is listed as failed. */
export const maxAttempts = 3;

/**
 * Creates the job and its rows in one statement, so a file is queued whole or not at all. The rows
 * of the titles that wait carry the entry; the rows left out carry the reason.
 */
export async function enqueueImport(
  db: SqlExecutor,
  userId: string,
  job: NewImportJob,
): Promise<string> {
  const rows = [
    ...job.pending.map((row) => ({
      position: row.position,
      title: row.title,
      state: "pending",
      reason: null,
      entry: row.entry,
    })),
    ...job.skipped.map((row) => ({
      position: row.position,
      title: row.title,
      state: "skipped",
      reason: row.reason,
      entry: null,
    })),
  ];
  const { rows: made } = (await db.execute(sql`
    WITH job AS (
      INSERT INTO import_jobs
        (user_id, replace, keep_visibility, locale, total, added, replaced, kept)
      VALUES (${userId}::uuid, ${job.replace}, ${job.keepVisibility}, ${job.locale}, ${job.total},
              ${job.written.added}, ${job.written.replaced}, ${job.written.kept})
      RETURNING id
    ),
    queued AS (
      INSERT INTO import_rows (job_id, position, title, state, reason, entry)
      SELECT job.id, x.position, x.title, x.state, x.reason, x.entry
      FROM job CROSS JOIN jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x(position int, title text, state text, reason text, entry jsonb)
      RETURNING 1
    )
    SELECT id FROM job
  `)) as RawRows;
  return String(made[0]?.id);
}

/** One title taken from the queue, with what its job asked for. */
export type ClaimedRow = {
  id: string;
  jobId: string;
  userId: string;
  position: number;
  title: string;
  entry: unknown;
  attempts: number;
  replace: boolean;
  keepVisibility: boolean;
  locale: "es" | "en";
};

/**
 * Takes the titles that are due, for the run of the queue: at most `rowsPerRun`, from at most
 * `peoplePerRun` people (the ones waiting longest), at most `rowsPerPersonPerRun` each, and only
 * from the oldest job of a person that has something due (a job whose rows are all paused or
 * waiting after a failure does not hold back a newer one). Each is leased for 15 minutes
 * (`retry_at`), so a second run that starts meanwhile does not take it again, and a run that dies
 * leaves the title to be taken later. An erased account has nothing here: its jobs went with it.
 */
export async function claimImportRows(db: SqlExecutor): Promise<ClaimedRow[]> {
  const { rows } = (await db.execute(sql`
    WITH due AS (
      SELECT r.id, j.user_id, r.position,
             row_number() OVER (PARTITION BY j.user_id ORDER BY r.position) AS n,
             dense_rank() OVER (ORDER BY j.created_at, j.user_id) AS who
      FROM import_rows r
      JOIN import_jobs j ON j.id = r.job_id
      JOIN users u ON u.id = j.user_id AND u.deleted_at IS NULL
      WHERE r.state = 'pending' AND r.retry_at <= now()
        AND j.id = (
          SELECT j2.id FROM import_jobs j2
          WHERE j2.user_id = j.user_id
            AND EXISTS (
              SELECT 1 FROM import_rows p
              WHERE p.job_id = j2.id AND p.state = 'pending' AND p.retry_at <= now()
            )
          ORDER BY j2.created_at, j2.id
          LIMIT 1
        )
    ),
    picked AS (
      SELECT id FROM due
      WHERE n <= ${rowsPerPersonPerRun} AND who <= ${peoplePerRun}
      ORDER BY who, n
      LIMIT ${rowsPerRun}
    ),
    claimed AS (
      UPDATE import_rows SET retry_at = now() + interval '15 minutes'
      WHERE id IN (SELECT id FROM picked)
      RETURNING id, job_id, position, title, entry, attempts
    )
    SELECT c.id, c.job_id, j.user_id, c.position, c.title, c.entry, c.attempts,
           j.replace, j.keep_visibility, j.locale
    FROM claimed c JOIN import_jobs j ON j.id = c.job_id
    ORDER BY j.created_at, j.user_id, c.position
  `)) as RawRows;
  return rows.map((row) => ({
    id: String(row.id),
    jobId: String(row.job_id),
    userId: String(row.user_id),
    position: Number(row.position),
    title: String(row.title),
    entry: row.entry,
    attempts: Number(row.attempts),
    replace: row.replace === true,
    keepVisibility: row.keep_visibility === true,
    locale: row.locale === "en" ? "en" : "es",
  }));
}

/** What a run did with the titles it took, written back in one statement. */
export type RunOutcome = {
  /** Written to the library: the row goes, the counters of the job grow. */
  done: readonly string[];
  /** Left out for good, with the reason. */
  skipped: readonly { id: string; reason: QueueSkipReason }[];
  /** The provider did not answer: try again in an hour, and after the last try list it as failed. */
  retry: readonly string[];
  /** Added to the counters of each job. */
  counts: readonly {
    jobId: string;
    added: number;
    replaced: number;
    kept: number;
  }[];
};

export async function finishImportRows(
  db: SqlExecutor,
  outcome: RunOutcome,
): Promise<void> {
  if (
    outcome.done.length === 0 &&
    outcome.skipped.length === 0 &&
    outcome.retry.length === 0 &&
    outcome.counts.length === 0
  ) {
    return;
  }
  await db.execute(sql`
    WITH removed AS (
      DELETE FROM import_rows
      WHERE id IN (
        SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(outcome.done)}::jsonb)
      )
      RETURNING 1
    ),
    left_out AS (
      UPDATE import_rows r
      SET state = 'skipped', reason = x.reason, entry = NULL
      FROM jsonb_to_recordset(${JSON.stringify(outcome.skipped)}::jsonb) AS x(id uuid, reason text)
      WHERE r.id = x.id
      RETURNING 1
    ),
    retried AS (
      UPDATE import_rows r
      SET attempts = r.attempts + 1,
          retry_at = now() + interval '1 hour',
          state = CASE WHEN r.attempts + 1 >= ${maxAttempts}::int THEN 'skipped' ELSE r.state END,
          reason = CASE WHEN r.attempts + 1 >= ${maxAttempts}::int THEN 'failed' ELSE r.reason END,
          entry = CASE WHEN r.attempts + 1 >= ${maxAttempts}::int THEN NULL ELSE r.entry END
      WHERE r.id IN (
        SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(outcome.retry)}::jsonb)
      )
      RETURNING 1
    ),
    counted AS (
      UPDATE import_jobs j
      SET added = j.added + x.added, replaced = j.replaced + x.replaced, kept = j.kept + x.kept
      FROM jsonb_to_recordset(${JSON.stringify(outcome.counts)}::jsonb)
        AS x("jobId" uuid, added int, replaced int, kept int)
      WHERE j.id = x."jobId"
      RETURNING 1
    )
    SELECT 1
  `);
}

/**
 * Nothing of these people is tried again before the next UTC day, because their budget of new
 * titles is spent. Their waiting titles are paused, not changed. A separate statement from
 * `finishImportRows`, so no row is touched twice by one statement.
 */
export async function pauseUntilTomorrow(
  db: SqlExecutor,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db.execute(sql`
    UPDATE import_rows r
    SET retry_at = (date_trunc('day', now() AT TIME ZONE 'utc') + interval '1 day') AT TIME ZONE 'utc'
    FROM import_jobs j
    WHERE j.id = r.job_id AND r.state = 'pending'
      AND j.user_id IN (
        SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(userIds)}::jsonb)
      )
  `);
}

/** Deletes the jobs made more than 30 days ago, and their rows with them. One statement. */
export async function pruneImportJobs(db: SqlExecutor): Promise<number> {
  const { rows } = (await db.execute(sql`
    WITH deleted AS (
      DELETE FROM import_jobs WHERE created_at < now() - interval '30 days' RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM deleted
  `)) as RawRows;
  return Number(rows[0]?.deleted ?? 0);
}

export type ImportProgress = {
  createdAt: Date;
  total: number;
  added: number;
  replaced: number;
  kept: number;
  /** Titles that still wait for their turn. */
  pending: number;
  /** Titles left out, and the first of them with the reason. */
  skippedCount: number;
  skipped: { title: string; reason: QueueSkipReason }[];
};

/** How many of the titles left out the page lists; the rest is a count. */
export const skippedShown = 50;

/** The latest import of a person: what was written, what waits and what went wrong. */
export async function latestImportProgress(
  db: SqlExecutor,
  userId: string,
): Promise<ImportProgress | null> {
  const { rows } = (await db.execute(sql`
    SELECT j.created_at, j.total, j.added, j.replaced, j.kept,
           (SELECT count(*)::int FROM import_rows r
             WHERE r.job_id = j.id AND r.state = 'pending') AS pending,
           (SELECT count(*)::int FROM import_rows r
             WHERE r.job_id = j.id AND r.state = 'skipped') AS skipped_count,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('title', s.title, 'reason', s.reason)
                              ORDER BY s.position)
             FROM (
               SELECT title, reason, position FROM import_rows
               WHERE job_id = j.id AND state = 'skipped'
               ORDER BY position LIMIT ${skippedShown}
             ) s
           ), '[]'::jsonb) AS skipped
    FROM import_jobs j
    WHERE j.user_id = ${userId}::uuid
    ORDER BY j.created_at DESC, j.id DESC
    LIMIT 1
  `)) as RawRows;
  const row = rows[0];
  if (!row) return null;
  return {
    createdAt: new Date(String(row.created_at)),
    total: Number(row.total),
    added: Number(row.added),
    replaced: Number(row.replaced),
    kept: Number(row.kept),
    pending: Number(row.pending),
    skippedCount: Number(row.skipped_count),
    skipped: row.skipped as ImportProgress["skipped"],
  };
}
