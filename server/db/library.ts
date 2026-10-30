import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { ProfileDb } from "./profile";
import { libraryEntries, mediaItems } from "./schema";
import { localizedTitleSql } from "./titles";
import type { Locale } from "../providers/types";
import type { EntryState, SeasonCount } from "../library/rules";
import {
  pageSize,
  sectionOrder,
  type LibraryQuery,
  type LibraryStatus,
  type LibraryType,
  type Visibility,
} from "../library/schema";
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
  progressUnit: libraryEntries.progressUnit,
  progressTotal: libraryEntries.progressTotal,
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
 * The status this person gave to each of these titles, for the ones they hold. A title they do
 * not hold is not in the answer. The id of the person comes from the session, and the ids are the
 * ones of the results of a search.
 */
export async function getEntryStatuses(
  db: ProfileDb,
  userId: string,
  mediaIds: readonly string[],
): Promise<Map<string, LibraryStatus>> {
  if (mediaIds.length === 0) return new Map();
  const rows = await db
    .select({ mediaId: libraryEntries.mediaId, status: libraryEntries.status })
    .from(libraryEntries)
    .where(
      and(
        eq(libraryEntries.userId, userId),
        inArray(libraryEntries.mediaId, [...mediaIds]),
      ),
    );
  return new Map(rows.map((row) => [row.mediaId, row.status]));
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
      progressUnit: next.progressUnit,
      progressTotal: next.progressTotal,
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
  progressUnit: EntryState["progressUnit"];
  progressTotal: number | null;
  score: number | null;
  visibility: Visibility;
  /** The private notes of the person, up to the limit of the editor. */
  notes: string | null;
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

/** Makes the text of the search box literal for LIKE: `%` and `_` are not wildcards there. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/**
 * A title matches the search when it contains the text, ignoring case and accents, in its name,
 * its original title or the name it has in any language we hold.
 */
function matchesSearch(text: string): SQL {
  const needle = sql`immutable_unaccent(lower(${`%${escapeLike(text)}%`}::text))`;
  const like = (value: SQL) =>
    sql`immutable_unaccent(lower(${value})) LIKE ${needle}`;
  return sql`(
    ${like(sql`${mediaItems.title}`)}
    OR ${like(sql`coalesce(${mediaItems.originalTitle}, '')`)}
    OR EXISTS (
      SELECT 1 FROM jsonb_each_text(${mediaItems.titles}) AS other_title
      WHERE ${like(sql`other_title.value`)}
    )
  )`;
}

function filtersOf(
  userId: string,
  query: LibraryQuery,
  withType: boolean,
): SQL {
  const parts: SQL[] = [eq(libraryEntries.userId, userId)];
  if (withType && query.type) parts.push(eq(mediaItems.type, query.type));
  if (query.year) parts.push(eq(mediaItems.year, query.year));
  // "Score" filters by a minimum: 8 shows everything rated 8 or higher. "none" is the opposite end:
  // what was never rated, which no minimum can show.
  if (query.score === "none") parts.push(sql`${libraryEntries.score} IS NULL`);
  else if (query.score) {
    parts.push(sql`${libraryEntries.score} >= ${query.score}`);
  }
  if (query.rated) parts.push(eq(libraryEntries.score, query.rated));
  if (query.visibility) {
    parts.push(eq(libraryEntries.visibility, query.visibility));
  }
  if (query.q) parts.push(matchesSearch(query.q));
  return and(...parts) ?? sql`true`;
}

export type LibrarySection = {
  status: LibraryStatus;
  /** Every entry of the section that matches, not only the ones of this page. */
  total: number;
  page: number;
  pages: number;
  rows: LibraryRow[];
};

export type Library = {
  /** Entries that match the search and the filters, by tab: all of them, and each type. */
  counts: Record<"all" | LibraryType, number>;
  /** The five sections of the tab, in the order they are shown, empty ones included. */
  sections: LibrarySection[];
};

/**
 * The library of this person for one tab: how many entries each tab has, and a page of every
 * status section. Two queries however many sections there are: one counts by type and status
 * (which gives the totals and clamps each page to the last one that exists), and one takes the
 * page of every section with a window function. The search and the filters apply to both, the
 * type only to the second.
 */
export async function listLibrary(
  db: ProfileDb,
  userId: string,
  query: LibraryQuery,
  locale: Locale,
): Promise<Library> {
  const { rows: counted } = (await db.execute(sql`
    SELECT ${mediaItems.type}::text AS type, ${libraryEntries.status}::text AS status,
           count(*)::int AS total
    FROM ${libraryEntries}
    JOIN ${mediaItems} ON ${libraryEntries.mediaId} = ${mediaItems.id}
    WHERE ${filtersOf(userId, query, false)}
    GROUP BY 1, 2
  `)) as RawRows;

  const counts: Library["counts"] = {
    all: 0,
    anime: 0,
    movie: 0,
    series: 0,
    book: 0,
    manga: 0,
  };
  const totals: Record<string, number> = {};
  for (const row of counted) {
    const total = Number(row.total);
    const type = String(row.type);
    counts.all += total;
    if (type in counts) counts[type as LibraryType] += total;
    if (!query.type || query.type === type) {
      const status = String(row.status);
      totals[status] = (totals[status] ?? 0) + total;
    }
  }

  // A page past the last one (a link that went stale) shows the last one.
  const pageCount = (status: LibraryStatus) =>
    Math.max(1, Math.ceil((totals[status] ?? 0) / pageSize));
  const pages = Object.fromEntries(
    sectionOrder.map((status) => [
      status,
      Math.min(query.pages[status], pageCount(status)),
    ]),
  ) as Record<LibraryStatus, number>;

  const byStatus = new Map<string, LibraryRow[]>();
  if (Object.keys(totals).length > 0) {
    const pagesJson = JSON.stringify(pages);
    const { rows } = (await db.execute(sql`
      SELECT * FROM (
        SELECT ${libraryEntries.mediaId} AS media_id,
               ${localizedTitleSql("media_items", locale)} AS title,
               ${mediaItems.type}::text AS type, ${mediaItems.year} AS year,
               ${mediaItems.imageUrl} AS image_url, ${libraryEntries.status}::text AS status,
               ${libraryEntries.progress} AS progress, ${libraryEntries.score} AS score,
               ${libraryEntries.progressUnit} AS progress_unit,
               ${libraryEntries.progressTotal} AS progress_total,
               ${libraryEntries.visibility}::text AS visibility,
               ${libraryEntries.notes} AS notes,
               (
                 SELECT count(*)::int FROM library_viewings v WHERE v.entry_id = ${libraryEntries.id}
               ) + (CASE WHEN ${libraryEntries.status} = 'completed' THEN 1 ELSE 0 END)
                 AS times_watched,
               (
                 SELECT count(*)::int FROM media_parts e
                 JOIN media_parts s ON s.id = e.parent_id
                 WHERE e.media_id = ${mediaItems.id} AND e.kind = 'episode' AND s.number > 0
               ) AS total_episodes,
               row_number() OVER (
                 PARTITION BY ${libraryEntries.status}
                 ORDER BY ${sql.join(orderBy(locale)[query.sort], sql`, `)}, ${libraryEntries.id}
               ) AS rn
        FROM ${libraryEntries}
        JOIN ${mediaItems} ON ${libraryEntries.mediaId} = ${mediaItems.id}
        WHERE ${filtersOf(userId, query, true)}
      ) ranked
      WHERE ranked.rn > ((${pagesJson}::jsonb ->> ranked.status)::int - 1) * ${pageSize}::int
        AND ranked.rn <= (${pagesJson}::jsonb ->> ranked.status)::int * ${pageSize}::int
      ORDER BY ranked.rn
    `)) as RawRows;
    for (const row of rows) {
      const status = String(row.status);
      const list = byStatus.get(status) ?? [];
      list.push({
        mediaId: String(row.media_id),
        title: String(row.title),
        type: String(row.type),
        year: row.year === null ? null : Number(row.year),
        imageUrl: row.image_url === null ? null : String(row.image_url),
        status: status as LibraryStatus,
        progress: Number(row.progress),
        score: row.score === null ? null : Number(row.score),
        visibility: String(row.visibility) as Visibility,
        notes: row.notes === null ? null : String(row.notes),
        timesWatched: Number(row.times_watched),
        totalEpisodes: Number(row.total_episodes),
        progressUnit:
          row.progress_unit === null
            ? null
            : (String(row.progress_unit) as LibraryRow["progressUnit"]),
        progressTotal:
          row.progress_total === null ? null : Number(row.progress_total),
      });
      byStatus.set(status, list);
    }
  }

  return {
    counts,
    sections: sectionOrder.map((status) => ({
      status,
      total: totals[status] ?? 0,
      page: pages[status],
      pages: pageCount(status),
      rows: byStatus.get(status) ?? [],
    })),
  };
}
