import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { localizedTitleSql } from "./titles";
import type { Locale } from "../providers/types";
import {
  canView,
  levels,
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

/** The levels of entry that the viewer may see on this profile: the ones `canView` allows. */
export function visibleLevels(
  relationship: Relationship,
  profileLevel: Level,
): Level[] {
  return levels.filter((level) => canView(relationship, level, profileLevel));
}

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
    section.entries.push({
      mediaId: String(row.media_id),
      title: String(row.title),
      type: String(row.type),
      year: row.year === null ? null : Number(row.year),
      imageUrl: row.image_url === null ? null : String(row.image_url),
      score: row.score === null ? null : Number(row.score),
    });
  }
  return sections;
}
