import { sql, type SQL } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import type { ProfileDb } from "./profile";
import { text } from "./person";
import { blockedBetween, levelAllowed } from "./person-visibility";
import {
  reviewHeldSql,
  reviewLevelSql,
  reviewShown,
  reviewsFrom,
} from "./reviews";
import { localizedTitleSql, sharedTitleSql } from "./titles";
import type { ActivityKind } from "../library/activity";
import type { Locale } from "../providers/types";
import { reviewExcerptLength } from "../reviews/rules";
import { canView, type Level } from "../social/can-view";

/**
 * The activity feed of `/social` and its likes (SAG-22, ADR-055). The feed shows the events of the
 * people the viewer follows and the viewer's own, newest first, and a like is allowed on exactly the
 * events the feed would show to that person. Both read through ONE fragment, `shownEvents`, so the
 * page and the like can never disagree about who may see what.
 *
 * Every event is read **through the current library entry of its title and the current profile**
 * of its author (ADR-054): the level stored in the event is only the most it may ever show, the
 * strictest of the three decides, and an event whose entry is gone (a race left it after the title
 * was removed) has nothing to join and never shows.
 */

/**
 * The kinds of event the feed shows; `list_created` has no writer yet (ADR-054). `reviewed` is
 * written with a review (ADR-053) and read through it.
 */
export const feedKinds = [
  "started",
  "progressed",
  "completed",
  "dropped",
  "rated",
  "reviewed",
] as const satisfies readonly (ActivityKind | "reviewed")[];

/** How many events one page of the feed shows. */
export const feedPageSize = 20;

/**
 * Where the next page starts: the time of the last event shown, in microseconds since 1970 (the
 * precision Postgres keeps, so no event is repeated or skipped because of rounding), and its id.
 */
export type FeedCursor = { micros: string; id: string };

const cursorPattern =
  /^(\d{1,17})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The cursor of the address (`?before=`), or null when it is missing or not one we wrote. */
export function parseFeedCursor(value: string | null): FeedCursor | null {
  const match = value === null ? null : cursorPattern.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { micros: match[1], id: match[2] };
}

export const formatFeedCursor = (cursor: FeedCursor) =>
  `${cursor.micros}_${cursor.id}`;

export type FeedEvent = {
  id: string;
  type: (typeof feedKinds)[number];
  payload: Record<string, unknown>;
  createdAt: Date;
  /** The strictest of the event, the entry and the profile: who may see it right now. */
  level: Level;
  /** The viewer wrote it: their own events show the likes but cannot be liked. */
  mine: boolean;
  actor: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  media: { id: string; type: string; title: string; imageUrl: string | null };
  likes: number;
  liked: boolean;
  /**
   * The review of a `reviewed` event: the start of its text (a little more than the excerpt, so
   * the page can cut it at a word), whether there is more, and its spoiler mark.
   */
  review: { start: string; more: boolean; spoiler: boolean } | null;
};

export type FeedPage = { events: FeedEvent[]; next: FeedCursor | null };

// The level that decides: the strictest of the event, the entry and the profile. `privacy_level`
// is declared public, friends, private, so GREATEST is the strictest (ADR-054). A review has a
// level of its own, independent of the entry (ADR-053), so its event shows at the review's level.
const levelNow = sql`(CASE WHEN a.type = 'reviewed' THEN ${reviewLevelSql}
  ELSE GREATEST(a.visibility, le.visibility, u.privacy) END)`;

const follows = (follower: SQL, followee: SQL) => sql`
  EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${follower} AND f.followee_id = ${followee})`;

/**
 * The events the viewer may see, as `FROM ... WHERE ...` over the aliases `a` (the event), `u` (its
 * author), `le` (the current entry of its title) and `m` (the title). Their own, whatever the
 * level; or of somebody they follow, not muted, with no block either way, that `canView` allows for
 * a follower, or for a friend when the author follows them back. Erased authors, titles a person
 * made for themselves and kinds the feed does not show are left out. A `reviewed` event is read
 * through its review (`r`): with no review it never shows, and to others only while the review was
 * not removed and the author's account is a day old (ADR-053).
 */
const shownEvents = (viewerId: string): SQL => {
  const viewer = sql`${viewerId}::uuid`;
  return sql`
    FROM activity a
    JOIN users u ON u.id = a.actor_id
    JOIN library_entries le ON le.user_id = a.actor_id AND le.media_id = a.media_id
    JOIN media_items m ON m.id = a.media_id
    LEFT JOIN reviews r ON r.activity_id = a.id
    WHERE u.deleted_at IS NULL
      AND (
        a.type <> 'reviewed'
        OR (
          r.id IS NOT NULL
          AND (a.actor_id = ${viewer} OR (r.removed_at IS NULL AND NOT ${reviewHeldSql}))
        )
      )
      -- Only the viewer and the people they follow: written as a list of authors, so the index of
      -- each author's events is used instead of reading the activity of the whole site.
      AND a.actor_id IN (
        SELECT ${viewer} UNION ALL SELECT fl.followee_id FROM follows fl WHERE fl.follower_id = ${viewer}
      )
      AND ${sharedTitleSql("m")}
      AND a.type::text IN (${sql.join(
        feedKinds.map((kind) => sql`${kind}`),
        sql`, `,
      )})
      AND (
        a.actor_id = ${viewer}
        OR (
          NOT EXISTS (
            SELECT 1 FROM mutes mu WHERE mu.muter_id = ${viewer} AND mu.muted_id = a.actor_id
          )
          AND NOT ${blockedBetween(viewer, sql`a.actor_id`)}
          AND (
            ${levelAllowed(levelNow, (level) => canView("follower", level))}
            OR (
              ${follows(sql`a.actor_id`, viewer)}
              AND ${levelAllowed(levelNow, (level) => canView("friend", level))}
            )
          )
        )
      )`;
};

const isFeedKind = (value: string): value is FeedEvent["type"] =>
  (feedKinds as readonly string[]).includes(value);

// The feed reads only the start of a review: a little more than the excerpt, so it can be cut at a
// word, and never the whole text of ten reviews on one page.
const reviewStartLength = reviewExcerptLength + 40;

/**
 * The events the viewer may like, as `SELECT id, title`: every event the feed shows them, and the
 * event of every review the title page shows them (ADR-056), so the like of a review is one count
 * wherever it is given. The viewer's own are in it; a writer leaves them out.
 */
const likeableEvents = (viewerId: string): SQL => sql`
  SELECT a.id, m.title, a.actor_id ${shownEvents(viewerId)}
  UNION
  SELECT r.activity_id, m.title, r.user_id ${reviewsFrom}
  WHERE r.activity_id IS NOT NULL AND ${reviewShown(viewerId)}`;

/**
 * One page of the feed of the viewer, newest first. `before` is the cursor of the page before, or
 * null for the newest. An event of today moves up when it is updated (ADR-054), so a page read
 * later can repeat or miss one of those: each page is read on its own, which is fine here.
 */
export async function readFeed(
  db: SqlExecutor,
  viewerId: string,
  locale: Locale,
  before: FeedCursor | null,
): Promise<FeedPage> {
  const after = before
    ? sql`AND (a.created_at, a.id) < ('epoch'::timestamptz + ${before.micros}::bigint * interval '1 microsecond', ${before.id}::uuid)`
    : sql``;
  const { rows } = await db.execute(sql`
    SELECT a.id, a.type::text AS type, a.payload, a.created_at,
           (extract(epoch FROM a.created_at) * 1000000)::bigint::text AS micros,
           ${levelNow}::text AS level, a.actor_id = ${viewerId}::uuid AS mine,
           u.username, u.display_name, u.avatar_url,
           m.id AS media_id, m.type::text AS media_type,
           ${localizedTitleSql("m", locale)} AS title, m.image_url,
           (SELECT count(*) FROM likes l WHERE l.activity_id = a.id)::int AS likes,
           EXISTS (
             SELECT 1 FROM likes l WHERE l.activity_id = a.id AND l.user_id = ${viewerId}::uuid
           ) AS liked,
           left(r.body, ${reviewStartLength}) AS review_start,
           char_length(r.body) > ${reviewStartLength} AS review_more, r.spoiler
    ${shownEvents(viewerId)}
    ${after}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${feedPageSize + 1}
  `);

  const events = rows.slice(0, feedPageSize).flatMap((row): FeedEvent[] => {
    const type = String(row.type);
    if (!isFeedKind(type)) return [];
    return [
      {
        id: String(row.id),
        type,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        createdAt: new Date(row.created_at as string | Date),
        level: String(row.level) as Level,
        mine: row.mine === true,
        actor: {
          username: String(row.username),
          displayName: text(row.display_name),
          avatarUrl: text(row.avatar_url),
        },
        media: {
          id: String(row.media_id),
          type: String(row.media_type),
          title: String(row.title),
          imageUrl: text(row.image_url),
        },
        likes: Number(row.likes),
        liked: row.liked === true,
        review:
          row.review_start === null || row.review_start === undefined
            ? null
            : {
                start: String(row.review_start),
                more: row.review_more === true,
                spoiler: row.spoiler === true,
              },
      },
    ];
  });

  const last = rows[feedPageSize - 1];
  const next =
    rows.length > feedPageSize && last
      ? { micros: String(last.micros), id: String(last.id) }
      : null;
  return { events, next };
}

/**
 * Likes an event (`liked` true) or takes the like back, as the person of the session, and answers
 * how many likes the event has now. Both are idempotent. A like is only written on an event the
 * feed or a title page shows to that person (`likeableEvents`) and not on their own; the answer is
 * null when they may not see the
 * event (it is gone, hidden or never theirs to see), the same whatever the reason. Taking a like
 * back always deletes it and always answers, even when the event can no longer be seen; then the
 * count is null, so a hidden event never tells how many likes it has.
 */
export async function setLike(
  db: SqlExecutor,
  viewerId: string,
  activityId: string,
  liked: boolean,
): Promise<{ likes: number | null } | null> {
  const viewer = sql`${viewerId}::uuid`;
  // This statement cannot see its own insert or delete, so the count is the likes of the others
  // plus the viewer's own as it is after the change.
  const statement = liked
    ? sql`
      WITH shown AS (
        SELECT e.id FROM (${likeableEvents(viewerId)}) e
        WHERE e.id = ${activityId}::uuid AND e.actor_id <> ${viewer}
      ),
      added AS (
        INSERT INTO likes (user_id, activity_id)
        SELECT ${viewer}, id FROM shown
        ON CONFLICT DO NOTHING
      )
      SELECT (
        SELECT count(*) FROM likes l WHERE l.activity_id = shown.id AND l.user_id <> ${viewer}
      )::int + 1 AS likes
      FROM shown`
    : sql`
      WITH removed AS (
        DELETE FROM likes WHERE user_id = ${viewer} AND activity_id = ${activityId}::uuid
      ),
      shown AS (
        SELECT e.id FROM (${likeableEvents(viewerId)}) e WHERE e.id = ${activityId}::uuid
      )
      SELECT (
        SELECT count(*) FROM likes l JOIN shown ON l.activity_id = shown.id
        WHERE l.user_id <> ${viewer}
      )::int AS likes, EXISTS (SELECT 1 FROM shown) AS shown`;
  const { rows } = await db.execute(statement);
  const [row] = rows;
  if (!row) return null;
  return { likes: row.shown === false ? null : Number(row.likes) };
}

export type ExportedLike = {
  type: string;
  title: string | null;
  createdAt: string;
};

/**
 * The likes of a person for the copy of "My data" (SAG-22, ADR-055): the kind of event, when they
 * liked it, and the title only while the feed still shows that event to them. A title the author
 * has since hidden (a stricter entry or profile, a block, a removed title) is left out, and so is
 * the author's name, always: that is what someone else did.
 */
export async function likesForExport(
  db: ProfileDb,
  userId: string,
): Promise<ExportedLike[]> {
  const { rows } = (await db.execute(sql`
    SELECT a.type::text AS type, still.title, l.created_at
    FROM likes l
    JOIN activity a ON a.id = l.activity_id
    LEFT JOIN (${likeableEvents(userId)}) still ON still.id = l.activity_id
    WHERE l.user_id = ${userId}::uuid
    ORDER BY l.created_at, l.activity_id
  `)) as { rows: Record<string, unknown>[] };
  return rows.map((row) => ({
    type: String(row.type),
    title: text(row.title),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  }));
}
