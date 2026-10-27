import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import type { ProfileDb } from "./profile";
import { libraryEntries, mediaItems } from "./schema";
import { localizedTitleSql } from "./titles";
import type { Locale } from "../providers/types";
import type { EntryState, SeasonCount } from "../library/rules";
import { pageSize, type LibraryQuery } from "../library/schema";
import { maxViewings } from "./viewings";

// Neon (HTTP) and `pg` both answer a raw statement with `{ rows }`; the type of the shared
// database does not say so.
type RawRows = { rows: Record<string, unknown>[] };

// Every query here has the id of the person in its WHERE, taken from the verified session by the
// caller. A title id from the address or from the form is never enough to read or change an entry.

/** Episodes of one title, season by season. Specials (season 0) are not counted. */
export async function getSeasonCounts(
  db: ProfileDb,
  mediaId: string,
): Promise<SeasonCount[]> {
  const { rows } = (await db.execute(sql`
    SELECT s.number AS season, count(e.id)::int AS episodes
    FROM media_parts s
    LEFT JOIN media_parts e ON e.parent_id = s.id AND e.kind = 'episode'
    WHERE s.media_id = ${mediaId}::uuid AND s.kind = 'season' AND s.number > 0
    GROUP BY s.number
    ORDER BY s.number
  `)) as RawRows;
  return rows.map((row) => ({
    number: Number(row.season),
    episodes: Number(row.episodes),
  }));
}

export const totalEpisodes = (seasons: readonly SeasonCount[]) =>
  seasons.reduce((sum, season) => sum + season.episodes, 0);

export type StoredEntry = EntryState & {
  mediaId: string;
  title: string;
  type: string;
  year: number | null;
  imageUrl: string | null;
  updatedAt: Date;
};

const entryColumns = (locale: Locale) => ({
  mediaId: libraryEntries.mediaId,
  status: libraryEntries.status,
  progress: libraryEntries.progress,
  score: libraryEntries.score,
  startedAt: libraryEntries.startedAt,
  finishedAt: libraryEntries.finishedAt,
  notes: libraryEntries.notes,
  visibility: libraryEntries.visibility,
  updatedAt: libraryEntries.updatedAt,
  title: localizedTitleSql("media_items", locale),
  type: mediaItems.type,
  year: mediaItems.year,
  imageUrl: mediaItems.imageUrl,
});

/** The entry of this person for this title, or null when they have none. */
export async function getEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  locale: Locale,
): Promise<StoredEntry | null> {
  const [row] = await db
    .select(entryColumns(locale))
    .from(libraryEntries)
    .innerJoin(mediaItems, eq(libraryEntries.mediaId, mediaItems.id))
    .where(
      and(
        eq(libraryEntries.userId, userId),
        eq(libraryEntries.mediaId, mediaId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Adds a title to the library as "planned". A title that is already there stays as it is. A
 * title that does not exist, or that a person made for themselves (`custom`), is not added here.
 * Returns whether the title can be added: false means there is no such title.
 */
export async function addEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
): Promise<boolean> {
  const { rows } = (await db.execute(sql`
    WITH target AS (
      SELECT id FROM media_items WHERE id = ${mediaId}::uuid AND type <> 'custom'
    ),
    added AS (
      INSERT INTO library_entries (user_id, media_id)
      SELECT ${userId}::uuid, id FROM target
      ON CONFLICT ON CONSTRAINT library_entries_user_media_unique DO NOTHING
    )
    SELECT count(*)::int AS found FROM target
  `)) as RawRows;
  return Number(rows[0]?.found) > 0;
}

/** Writes the entry of this person for this title. False when they have no such entry. */
export async function saveEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  next: EntryState,
): Promise<boolean> {
  const updated = await db
    .update(libraryEntries)
    .set({
      status: next.status,
      progress: next.progress,
      score: next.score,
      startedAt: next.startedAt,
      finishedAt: next.finishedAt,
      notes: next.notes,
      visibility: next.visibility,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(libraryEntries.userId, userId),
        eq(libraryEntries.mediaId, mediaId),
      ),
    )
    .returning({ id: libraryEntries.id });
  return updated.length > 0;
}

/**
 * Starts a completed title again: saves the run that ends in the history of viewings, with its
 * dates, and writes the entry as the rules decided. One statement, so the run is saved if and only
 * if the entry restarts. False when the person has no completed entry for the title, or it
 * already holds the most viewings it can.
 */
export async function rewatchEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
  next: EntryState,
): Promise<boolean> {
  const { rows } = (await db.execute(sql`
    WITH archived AS (
      INSERT INTO library_viewings (entry_id, started_on, finished_on)
      SELECT id, started_at, finished_at FROM library_entries
      WHERE user_id = ${userId}::uuid AND media_id = ${mediaId}::uuid AND status = 'completed'
        AND (SELECT count(*) FROM library_viewings WHERE entry_id = library_entries.id) < ${maxViewings}
      RETURNING entry_id
    )
    UPDATE library_entries
    SET status = ${next.status}::library_status, progress = ${next.progress},
        started_at = ${next.startedAt}::date, finished_at = ${next.finishedAt}::date,
        updated_at = now()
    WHERE id IN (SELECT entry_id FROM archived)
    RETURNING id
  `)) as RawRows;
  return rows.length > 0;
}

/** Removes the entry of this person for this title. False when they had none. */
export async function removeEntry(
  db: ProfileDb,
  userId: string,
  mediaId: string,
): Promise<boolean> {
  const removed = await db
    .delete(libraryEntries)
    .where(
      and(
        eq(libraryEntries.userId, userId),
        eq(libraryEntries.mediaId, mediaId),
      ),
    )
    .returning({ id: libraryEntries.id });
  return removed.length > 0;
}

export type LibraryRow = {
  mediaId: string;
  title: string;
  type: string;
  year: number | null;
  imageUrl: string | null;
  status: EntryState["status"];
  progress: number;
  totalEpisodes: number;
  score: number | null;
  /** The earlier viewings, and the current run if it is completed. */
  timesWatched: number;
};

const orderBy = (locale: Locale): Record<LibraryQuery["sort"], SQL[]> => ({
  recent: [desc(libraryEntries.updatedAt)],
  title: [asc(sql`lower(${localizedTitleSql("media_items", locale)})`)],
  score: [
    sql`${libraryEntries.score} DESC NULLS LAST`,
    desc(libraryEntries.updatedAt),
  ],
  year: [
    sql`${mediaItems.year} DESC NULLS LAST`,
    desc(libraryEntries.updatedAt),
  ],
});

/** One page of the library of this person, filtered and sorted, and how many entries match. */
export async function listEntries(
  db: ProfileDb,
  userId: string,
  query: LibraryQuery,
  locale: Locale,
): Promise<{ rows: LibraryRow[]; total: number }> {
  const filters: (SQL | undefined)[] = [eq(libraryEntries.userId, userId)];
  if (query.type) filters.push(eq(mediaItems.type, query.type));
  if (query.status) filters.push(eq(libraryEntries.status, query.status));
  if (query.year) filters.push(eq(mediaItems.year, query.year));
  // "Score" filters by a minimum: 8 shows everything rated 8 or higher.
  if (query.score) filters.push(sql`${libraryEntries.score} >= ${query.score}`);
  const where = and(...filters);

  const rows = await db
    .select({
      mediaId: libraryEntries.mediaId,
      title: localizedTitleSql("media_items", locale),
      type: mediaItems.type,
      year: mediaItems.year,
      imageUrl: mediaItems.imageUrl,
      status: libraryEntries.status,
      progress: libraryEntries.progress,
      score: libraryEntries.score,
      rewatchCount: libraryEntries.rewatchCount,
      timesWatched: sql<number>`(
        SELECT count(*)::int FROM library_viewings v WHERE v.entry_id = ${libraryEntries.id}
      ) + (CASE WHEN ${libraryEntries.status} = 'completed' THEN 1 ELSE 0 END)`,
      totalEpisodes: sql<number>`(
        SELECT count(*)::int FROM media_parts e
        JOIN media_parts s ON s.id = e.parent_id
        WHERE e.media_id = ${mediaItems.id} AND e.kind = 'episode' AND s.number > 0
      )`,
    })
    .from(libraryEntries)
    .innerJoin(mediaItems, eq(libraryEntries.mediaId, mediaItems.id))
    .where(where)
    // The id at the end keeps entries that tie in the same order from one page to the next.
    .orderBy(...orderBy(locale)[query.sort], asc(libraryEntries.id))
    .limit(pageSize)
    .offset((query.page - 1) * pageSize);

  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(libraryEntries)
    .innerJoin(mediaItems, eq(libraryEntries.mediaId, mediaItems.id))
    .where(where);

  return {
    rows: rows.map((row) => ({
      ...row,
      totalEpisodes: Number(row.totalEpisodes),
      timesWatched: Number(row.timesWatched),
    })),
    total: Number(count?.total ?? 0),
  };
}
