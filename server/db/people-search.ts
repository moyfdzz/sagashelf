import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { toPerson, type Person } from "./person";
import { canSeeCard, levels } from "../social/can-view";
import { blockedBetween } from "./person-visibility";

/** The shortest start of a username that can be searched, so nobody can list every user. */
export const peopleQueryMinLength = 2;

/** The longest username there is: a longer search finds nobody. */
export const peopleQueryMaxLength = 30;

/** The most people one search gives, with no pages, so nobody can list every user. */
export const peopleSearchLimit = 20;

/** What a person typed, as a username starts: `@` is how usernames are written on the site. */
export const normalizePeopleQuery = (raw: string): string =>
  raw.trim().replace(/^@/, "").toLowerCase();

/** `%`, `_` and the escape itself are plain text in a search, not patterns. */
const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * The people whose username starts with `query` (SAG-115): only the card, which is all that a
 * search shows even of a public profile. The levels come from `canSeeCard`, the one policy: a
 * person with total privacy is never found. An erased account, the viewer and anybody blocked in
 * either direction are left out too. `viewerId` is the person of the verified session.
 */
export async function searchPeople(
  db: SqlExecutor,
  viewerId: string,
  query: string,
): Promise<Person[]> {
  const listed = levels.filter((level) => canSeeCard("stranger", level));
  const { rows } = await db.execute(sql`
    SELECT u.username, u.display_name, u.avatar_url
    FROM users u
    WHERE lower(u.username::text) LIKE ${`${escapeLike(query)}%`} ESCAPE '\\'
      AND u.deleted_at IS NULL
      AND u.id <> ${viewerId}::uuid
      AND u.privacy::text IN (${sql.join(
        listed.map((level) => sql`${level}`),
        sql`, `,
      )})
      AND NOT ${blockedBetween(sql`${viewerId}::uuid`, sql`u.id`)}
    ORDER BY lower(u.username::text)
    LIMIT ${peopleSearchLimit}::int
  `);
  return rows.map(toPerson);
}
