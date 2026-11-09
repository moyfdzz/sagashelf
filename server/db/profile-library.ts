import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { localizedTitleSql, titleShownSql } from "./titles";
import { libraryTypes, type LibraryType } from "../library/schema";
import type { Locale } from "../providers/types";
import {
  visibleLevels,
  type Level,
  type Relationship,
} from "../social/can-view";

/**
 * What the library of a person shows on their profile to somebody else (SAG-107, ADR-031). Only
 * entries that `canView` lets the viewer see are read: the level of each entry and the level of the
 * profile are given to it, and **the filter is in the query**, so an entry the viewer may not see
 * never leaves the database. The notes of an entry are not read at all: they are private to their
 * owner, whatever the level of the entry.
 */

/** The sections of the profile, in the order they are shown. */
export const profileStatuses = ["in_progress", "planned", "completed"] as const;

export type ProfileStatus = (typeof profileStatuses)[number];

/** How many entries of each section the profile shows. */
export const entriesPerSection = 12;

export type ProfileEntry = {
  mediaId: string;
  title: string;
  type: string;
  year: number | null;
  imageUrl: string | null;
  score: number | null;
};

export type ProfileSection = { total: number; entries: ProfileEntry[] };

export type ProfileSections = Record<ProfileStatus, ProfileSection>;

const empty = (): ProfileSections => ({
  in_progress: { total: 0, entries: [] },
  planned: { total: 0, entries: [] },
  completed: { total: 0, entries: [] },
});

const toEntry = (row: Record<string, unknown>): ProfileEntry => ({
  mediaId: String(row.media_id),
  title: String(row.title),
  type: String(row.type),
  year: row.year === null ? null : Number(row.year),
  imageUrl: row.image_url === null ? null : String(row.image_url),
  score: row.score === null ? null : Number(row.score),
});

/**
 * The sections "watching or reading now", "want to watch or read" and "completed" of a profile, as
 * the viewer may see them: the newest changed first, a few of each, and how many there are in all.
 * Ask for it only after `findProfile` said `full`.
 */
export async function getProfileSections(
  db: SqlExecutor,
  ownerId: string,
  profileLevel: Level,
  relationship: Relationship,
  locale: Locale,
): Promise<ProfileSections> {
  const allowed = visibleLevels(relationship, profileLevel);
  const sections = empty();
  if (allowed.length === 0) return sections;

  const { rows } = await db.execute(sql`
    SELECT * FROM (
      SELECT le.media_id, ${localizedTitleSql("m", locale)} AS title, m.type::text AS type,
             m.year, m.image_url, le.status::text AS status, le.score,
             row_number() OVER (PARTITION BY le.status ORDER BY le.updated_at DESC, le.id) AS rn,
             count(*) OVER (PARTITION BY le.status)::int AS total
      FROM library_entries le
      JOIN media_items m ON m.id = le.media_id
      WHERE le.user_id = ${ownerId}::uuid
        AND ${titleShownSql("m", relationship)}
        AND le.status::text IN (${sql.join(
          profileStatuses.map((status) => sql`${status}`),
          sql`, `,
        )})
        AND le.visibility::text IN (${sql.join(
          allowed.map((level) => sql`${level}`),
          sql`, `,
        )})
    ) ranked
    WHERE ranked.rn <= ${entriesPerSection}::int
    ORDER BY ranked.status, ranked.rn
  `);

  for (const row of rows) {
    const status = String(row.status) as ProfileStatus;
    const section = sections[status];
    section.total = Number(row.total);
    section.entries.push(toEntry(row));
  }
  return sections;
}

/** Titles in one page of a section (SAG-127). */
export const entriesPerPage = 24;

/** The last page of a section that can be asked for, the same limit as the lists of people. */
export const maxSectionPage = 100;

export type ProfileSectionCounts = Record<"all" | LibraryType, number>;

export type ProfileSectionPage = {
  entries: ProfileEntry[];
  hasMore: boolean;
  /** How many titles of the section the viewer may see, in all and of each type. */
  counts: ProfileSectionCounts;
};

const noCounts = (): ProfileSectionCounts => ({
  all: 0,
  anime: 0,
  movie: 0,
  series: 0,
  book: 0,
  manga: 0,
});

/**
 * One page of one section of a profile (SAG-127), with the same rule as `getProfileSections`: only
 * the levels `canView` allows are read, in the query, so the entries and the counts hold nothing
 * the viewer may not see. The notes are not read. The newest changed first. A title of a type with
 * no tab of its own is only under "all". Ask for it only after the viewer may see the profile.
 */
export async function getProfileSectionPage(
  db: SqlExecutor,
  ownerId: string,
  profileLevel: Level,
  relationship: Relationship,
  query: {
    status: ProfileStatus;
    type: LibraryType | null;
    page: number;
    locale: Locale;
  },
): Promise<ProfileSectionPage> {
  const allowed = visibleLevels(relationship, profileLevel);
  if (allowed.length === 0) {
    return { entries: [], hasMore: false, counts: noCounts() };
  }

  const page = Math.min(
    Math.max(1, Math.floor(query.page) || 1),
    maxSectionPage,
  );
  const offset = (page - 1) * entriesPerPage;
  const { rows } = await db.execute(sql`
    WITH visible AS (
      SELECT le.id, le.media_id, le.score, le.updated_at,
             ${localizedTitleSql("m", query.locale)} AS title, m.type::text AS type,
             m.year, m.image_url
      FROM library_entries le
      JOIN media_items m ON m.id = le.media_id
      WHERE le.user_id = ${ownerId}::uuid
        AND ${titleShownSql("m", relationship)}
        AND le.status::text = ${query.status}
        AND le.visibility::text IN (${sql.join(
          allowed.map((level) => sql`${level}`),
          sql`, `,
        )})
    ),
    shown AS (
      SELECT * FROM visible
      ${query.type ? sql`WHERE type = ${query.type}` : sql``}
      ORDER BY updated_at DESC, id
      LIMIT ${entriesPerPage + 1}::int OFFSET ${offset}::int
    )
    SELECT
      (SELECT jsonb_object_agg(type, n)
       FROM (SELECT type, count(*)::int AS n FROM visible GROUP BY type) by_type) AS counts,
      (SELECT jsonb_agg(
         jsonb_build_object(
           'media_id', media_id, 'title', title, 'type', type,
           'year', year, 'image_url', image_url, 'score', score
         ) ORDER BY updated_at DESC, id
       ) FROM shown) AS entries
  `);

  const found = (rows[0]?.counts ?? {}) as Record<string, number>;
  const counts = noCounts();
  counts.all = Object.values(found).reduce((sum, n) => sum + Number(n), 0);
  for (const type of libraryTypes) counts[type] = Number(found[type] ?? 0);

  const entries = (rows[0]?.entries ?? []) as Record<string, unknown>[];
  return {
    entries: entries.slice(0, entriesPerPage).map(toEntry),
    hasMore: entries.length > entriesPerPage,
    counts,
  };
}
