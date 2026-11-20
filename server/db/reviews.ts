import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { ProfileDb } from "./profile";
import { text } from "./person";
import { blockedBetween, followsSql, levelAllowed } from "./person-visibility";
import { sharedTitleSql } from "./titles";
import {
  newAccountHours,
  reviewPageSize,
  reviewsPerHour,
} from "../reviews/rules";
import { canView, type Level } from "../social/can-view";

/**
 * The reviews of titles (SAG-22, ADR-053 and ADR-056). Who sees a review is decided by ONE fragment,
 * `reviewShown`, which the title page, the like of a review and the export read; the feed reads the
 * same level (`reviewLevelSql`) and the same hold on new accounts (`reviewHeldSql`).
 */

/** The library statuses that allow a review: the title was started (ADR-053). */
export const reviewableStatuses = [
  "in_progress",
  "paused",
  "completed",
  "dropped",
] as const;

/** A library entry in this status allows a new review: the title was started (ADR-053). */
export const isReviewable = (status: string) =>
  (reviewableStatuses as readonly string[]).includes(status);

/**
 * The level a review shows at, over the aliases `r` (the review) and `u` (its author). Its own level,
 * independent of the library entry and of a locked (`friends`) profile; a profile with Total privacy
 * hides every review but to its author (ADR-053).
 */
export const reviewLevelSql = sql`(CASE WHEN u.privacy = 'private' THEN 'private'::privacy_level ELSE r.visibility END)`;

/** The account of `u` is too new for others to see its reviews yet (ADR-053). */
export const reviewHeldSql = sql`(u.created_at > now() - make_interval(hours => ${newAccountHours}))`;

/**
 * `level` (a SQL expression) is one the viewer may see on something of `u`: anybody for a public
 * one, a friend (each follows the other) for a friends one. A visitor (`viewerId` null) is only ever
 * a stranger. The block is checked by the caller.
 */
const levelSeenBy = (viewerId: string | null, level: SQL): SQL => {
  if (viewerId === null) {
    return levelAllowed(level, (one) => canView("signed_out", one));
  }
  const viewer = sql`${viewerId}::uuid`;
  return sql`(
    ${levelAllowed(level, (one) => canView("stranger", one))}
    OR (
      ${followsSql(viewer, sql`u.id`)} AND ${followsSql(sql`u.id`, viewer)}
      AND ${levelAllowed(level, (one) => canView("friend", one))}
    )
  )`;
};

/** The review, its author, the current library entry of its title and the title. */
export const reviewsFrom = sql`
  FROM reviews r
  JOIN users u ON u.id = r.user_id
  JOIN library_entries le ON le.user_id = r.user_id AND le.media_id = r.media_id
  JOIN media_items m ON m.id = r.media_id`;

/**
 * The reviews the viewer may see, as a condition over `reviewsFrom`. Their own always. Another
 * person's when it was not removed by a moderator, the author is not erased and their account is
 * a day old, there is no block either way and no mute by the viewer, and its level allows it. Titles
 * a person made for themselves never show. Read through the current entry of the title, like the
 * feed (ADR-055): a review whose entry is gone never shows.
 */
export function reviewShown(viewerId: string | null): SQL {
  const viewer = sql`${viewerId}::uuid`;
  const others = sql`
    r.removed_at IS NULL
    AND NOT ${reviewHeldSql}
    AND ${levelSeenBy(viewerId, reviewLevelSql)}`;
  if (viewerId === null) {
    return sql`u.deleted_at IS NULL AND ${sharedTitleSql("m")} AND ${others}`;
  }
  return sql`
    u.deleted_at IS NULL AND ${sharedTitleSql("m")}
    AND (
      r.user_id = ${viewer}
      OR (
        ${others}
        AND NOT ${blockedBetween(viewer, sql`r.user_id`)}
        AND NOT EXISTS (
          SELECT 1 FROM mutes mu WHERE mu.muter_id = ${viewer} AND mu.muted_id = r.user_id
        )
      )
    )`;
}

export type ReviewOrder = "relevant" | "recent";

export type TitleReview = {
  id: string;
  /** The event that carries the likes of the review; null only for a review written before it. */
  activityId: string | null;
  body: string;
  spoiler: boolean;
  /** The level it shows at now: the author's own page says it when it is not public. */
  level: Level;
  createdAt: Date;
  updatedAt: Date;
  mine: boolean;
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** The score of the author's library entry, only when the viewer may see that entry. */
  score: number | null;
  likes: number;
  liked: boolean;
};

export type ReviewPage = { reviews: TitleReview[]; more: boolean };

const orders: Record<ReviewOrder, SQL> = {
  relevant: sql`likes DESC, r.created_at DESC, r.id DESC`,
  recent: sql`r.created_at DESC, r.id DESC`,
};

/**
 * One page of the reviews of a title that the viewer may see (`page` from 1). The viewer's own
 * review comes first, then the most liked (ties by the newest) or the newest. The count of likes
 * changes between two pages, so a review can repeat or be skipped at the edge of a page: each page
 * is read on its own, which is fine at this scale.
 */
export async function readReviews(
  db: SqlExecutor,
  viewerId: string | null,
  mediaId: string,
  order: ReviewOrder,
  page: number,
): Promise<ReviewPage> {
  const viewer = sql`${viewerId}::uuid`;
  // The score belongs to the library entry, so it shows only where the entry would: the stricter
  // of the entry and the profile, the same rule as the library of a profile.
  const entryLevel = sql`GREATEST(le.visibility, u.privacy)`;
  const { rows } = await db.execute(sql`
    SELECT r.id, r.activity_id, r.body, r.spoiler, ${reviewLevelSql}::text AS level,
           r.created_at, r.updated_at, r.user_id = ${viewer} IS TRUE AS mine,
           u.username, u.display_name, u.avatar_url,
           CASE WHEN r.user_id = ${viewer} IS TRUE OR ${levelSeenBy(viewerId, entryLevel)}
                THEN le.score END AS score,
           (SELECT count(*) FROM likes l WHERE l.activity_id = r.activity_id)::int AS likes,
           EXISTS (
             SELECT 1 FROM likes l WHERE l.activity_id = r.activity_id AND l.user_id = ${viewer}
           ) AS liked
    ${reviewsFrom}
    WHERE r.media_id = ${mediaId}::uuid AND ${reviewShown(viewerId)}
    ORDER BY (r.user_id = ${viewer}) IS TRUE DESC, ${orders[order]}
    OFFSET ${(page - 1) * reviewPageSize}
    LIMIT ${reviewPageSize + 1}
  `);
  const reviews = rows.slice(0, reviewPageSize).map((row): TitleReview => ({
    id: String(row.id),
    activityId: text(row.activity_id),
    body: String(row.body),
    spoiler: row.spoiler === true,
    level: String(row.level) as Level,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
    mine: row.mine === true,
    author: {
      username: String(row.username),
      displayName: text(row.display_name),
      avatarUrl: text(row.avatar_url),
    },
    score: row.score === null ? null : Number(row.score),
    likes: Number(row.likes),
    liked: row.liked === true,
  }));
  return { reviews, more: rows.length > reviewPageSize };
}

export type OwnReview = {
  body: string;
  spoiler: boolean;
  visibility: Level;
  removed: boolean;
};

/** The review of this person for this title, for the form, or null when they have none. */
export async function getOwnReview(
  db: SqlExecutor,
  userId: string,
  mediaId: string,
): Promise<OwnReview | null> {
  const { rows } = await db.execute(sql`
    SELECT body, spoiler, visibility::text AS visibility, removed_at IS NOT NULL AS removed
    FROM reviews WHERE user_id = ${userId}::uuid AND media_id = ${mediaId}::uuid
  `);
  const [row] = rows;
  if (!row) return null;
  return {
    body: String(row.body),
    spoiler: row.spoiler === true,
    visibility: String(row.visibility) as Level,
    removed: row.removed === true,
  };
}

/**
 * What the form tells the author about who will see the review: the level of their profile (the
 * level a new review starts at; with Total privacy only they see it) and whether their account is
 * too new for others to see it yet.
 */
export async function getReviewerFacts(
  db: SqlExecutor,
  userId: string,
): Promise<{ privacy: Level; held: boolean }> {
  const { rows } = await db.execute(sql`
    SELECT u.privacy::text AS privacy, ${reviewHeldSql} AS held
    FROM users u WHERE u.id = ${userId}::uuid
  `);
  const [row] = rows;
  return {
    privacy: (text(row?.privacy) ?? "private") as Level,
    held: row?.held === true,
  };
}

export type ReviewInput = {
  body: string;
  fingerprint: string;
  spoiler: boolean;
  visibility: Level;
};

/**
 * `created` and `updated`: the review was written. `not_started`: the person has no entry of the
 * title in a status that allows a review (or the title is one they made for themselves).
 * `duplicate`: the same text is already their review of another title. `rate_limited`: they wrote
 * the most new reviews an hour allows. `conflict`: the review was created or deleted at the same
 * time by another request; reading the page again is enough.
 */
export type SaveReviewResult =
  | "created"
  | "updated"
  | "not_started"
  | "duplicate"
  | "rate_limited"
  | "conflict";

/**
 * Writes the review of this person for this title, a new one or an edit, in ONE statement that
 * checks every rule of ADR-053 that needs the database: the entry was started, the text is not a
 * duplicate of another of their reviews, and a new one is within the hourly limit. A new review
 * writes its `reviewed` event in the same statement, with the id the caller made (`eventId`), so
 * there is an event if and only if there is a review. An edit writes no new event: it only keeps
 * the stored level of the event equal to the review's (ADR-056).
 */
export async function saveReview(
  db: SqlExecutor,
  userId: string,
  mediaId: string,
  input: ReviewInput,
  eventId: string,
): Promise<SaveReviewResult> {
  const me = sql`${userId}::uuid`;
  const media = sql`${mediaId}::uuid`;
  const level = sql`${input.visibility}::privacy_level`;
  // The window of the hourly counter is still open (null when the person never wrote a review).
  const windowOpen = sql`(reviews_hour_start IS NOT NULL AND reviews_hour_start > now() - interval '1 hour')`;
  const { rows } = await db.execute(sql`
    WITH entry AS (
      SELECT le.id FROM library_entries le JOIN media_items m ON m.id = le.media_id
      WHERE le.user_id = ${me} AND le.media_id = ${media} AND ${sharedTitleSql("m")}
        AND le.status::text IN (${sql.join(
          reviewableStatuses.map((status) => sql`${status}`),
          sql`, `,
        )})
    ),
    existing AS (
      SELECT id FROM reviews WHERE user_id = ${me} AND media_id = ${media}
    ),
    duplicate AS (
      SELECT 1 FROM reviews
      WHERE user_id = ${me} AND media_id <> ${media} AND fingerprint = ${input.fingerprint}
      LIMIT 1
    ),
    -- A new review takes one unit of the hourly counter of the person, in the row of users: the
    -- update locks it, so two reviews sent together cannot both take the last unit, and a deleted
    -- review is still counted. The hour starts at the first review of the window.
    claimed AS (
      UPDATE users SET
        reviews_hour_count = CASE WHEN ${windowOpen} THEN reviews_hour_count + 1 ELSE 1 END,
        reviews_hour_start = CASE WHEN ${windowOpen} THEN reviews_hour_start ELSE now() END
      WHERE id = ${me}
        AND NOT EXISTS (SELECT 1 FROM existing)
        AND EXISTS (SELECT 1 FROM entry)
        AND NOT EXISTS (SELECT 1 FROM duplicate)
        AND (NOT ${windowOpen} OR reviews_hour_count < ${reviewsPerHour})
      RETURNING id
    ),
    -- An edit needs no started entry: a review stays when the title goes back to planned.
    allowed AS (
      SELECT 1
      WHERE NOT EXISTS (SELECT 1 FROM duplicate) AND EXISTS (SELECT 1 FROM existing)
    ),
    updated AS (
      UPDATE reviews
      SET body = ${input.body}, fingerprint = ${input.fingerprint}, spoiler = ${input.spoiler}::boolean,
          visibility = ${level}, updated_at = now()
      WHERE user_id = ${me} AND media_id = ${media} AND EXISTS (SELECT 1 FROM allowed)
      RETURNING activity_id
    ),
    event_level AS (
      UPDATE activity SET visibility = ${level}
      WHERE id IN (SELECT activity_id FROM updated)
    ),
    inserted AS (
      INSERT INTO reviews (user_id, media_id, body, fingerprint, spoiler, visibility, activity_id)
      SELECT ${me}, ${media}, ${input.body}, ${input.fingerprint}, ${input.spoiler}::boolean, ${level},
             ${eventId}::uuid
      FROM claimed
      ON CONFLICT ON CONSTRAINT reviews_user_media_unique DO NOTHING
      RETURNING activity_id
    ),
    event AS (
      INSERT INTO activity (id, actor_id, type, media_id, visibility)
      SELECT activity_id, ${me}, 'reviewed', ${media}, ${level} FROM inserted
    )
    SELECT EXISTS (SELECT 1 FROM entry) AS started,
           EXISTS (SELECT 1 FROM duplicate) AS duplicate,
           EXISTS (SELECT 1 FROM existing) AS existed,
           EXISTS (SELECT 1 FROM claimed) AS claimed,
           (SELECT count(*) FROM updated)::int AS updated,
           (SELECT count(*) FROM inserted)::int AS inserted
  `);
  const [row] = rows;
  if (!row) return "conflict";
  if (Number(row.inserted) > 0) return "created";
  if (Number(row.updated) > 0) return "updated";
  if (row.started !== true && row.existed !== true) return "not_started";
  if (row.duplicate === true) return "duplicate";
  if (row.existed !== true && row.claimed !== true) return "rate_limited";
  return "conflict";
}

/**
 * Deletes the review of this person for this title and, in the same statement, its event and so
 * the likes of the event. False when they had none.
 */
export async function deleteReview(
  db: SqlExecutor,
  userId: string,
  mediaId: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH removed AS (
      DELETE FROM reviews WHERE user_id = ${userId}::uuid AND media_id = ${mediaId}::uuid
      RETURNING activity_id
    ),
    event AS (
      DELETE FROM activity WHERE id IN (SELECT activity_id FROM removed)
    )
    SELECT count(*)::int AS removed FROM removed
  `);
  return Number(rows[0]?.removed) > 0;
}

export type ExportedReview = {
  title: string;
  body: string;
  spoiler: boolean;
  visibility: string;
  removed: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The reviews of a person for the copy of "My data" (ADR-053): all of them, as they wrote them. */
export async function reviewsForExport(
  db: ProfileDb,
  userId: string,
): Promise<ExportedReview[]> {
  const { rows } = (await db.execute(sql`
    SELECT m.title, r.body, r.spoiler, r.visibility::text AS visibility,
           r.removed_at IS NOT NULL AS removed, r.created_at, r.updated_at
    FROM reviews r JOIN media_items m ON m.id = r.media_id
    WHERE r.user_id = ${userId}::uuid
    ORDER BY r.created_at, r.id
  `)) as { rows: Record<string, unknown>[] };
  return rows.map((row) => ({
    title: String(row.title),
    body: String(row.body),
    spoiler: row.spoiler === true,
    visibility: String(row.visibility),
    removed: row.removed === true,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  }));
}
