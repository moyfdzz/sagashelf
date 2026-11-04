import { sql } from "drizzle-orm";

import type { SqlExecutor } from "./clerk-sync";
import { episodeAiredEvent } from "../webhooks/events";

/** How long a notification inside the app is kept (SAG-102), the same as the log of deliveries. */
export const keepNotificationDays = 30;

/**
 * How old an episode can be and still be announced (SAG-28, ADR-030). An episode whose time passed
 * longer ago is not told: the first run after the alerts are switched on, or after a long stop,
 * must not flood a channel with news that is days old.
 */
export const announceWindowDays = 3;

/** Titles a message lists; the rest are counted ("and 4 more"). */
export const maxTitlesPerMessage = 10;

export type AnnounceSummary = {
  /** Episodes whose time had come and that were marked as told, whoever follows them. */
  episodes: number;
  /** Messages queued: one per endpoint that has something to hear. */
  messages: number;
  /** Notifications written inside the app: one per person and episode (SAG-102). */
  notifications: number;
};

/**
 * Tells people about the episodes that have come out, in ONE statement (ADR-029: the change and its
 * events are atomic, and a statement is the only atomic unit on the HTTP client of the Worker).
 *
 * An episode is due when its `air_stamp` has passed (not older than the window) and it is newer than
 * the last one told for that title (`announced_stamp`). The statement marks it as told and queues the
 * messages together, so a title is told once however many times this runs, and two runs at the same
 * time cannot both tell it (the second waits for the row and then finds it marked).
 *
 * Who hears: a person with the title in their library as "in progress", who has not turned off the
 * alerts of that title (`notify_new_episodes`, SAG-101). That person gets a notification inside the
 * app (SAG-102), one per episode, whether or not they have a webhook; and if they have an endpoint
 * that is on and has asked for `episode.aired`, that endpoint also gets a message. An episode nobody
 * hears is still marked as told, so turning the switch on later does not bring an old one. Each
 * endpoint gets ONE message with all its episodes, a digest and not one per series, with the title in
 * the language of the person. The key of a message, and the one of a notification, are made from what
 * they tell, so even a repeat of the same statement could not queue them twice.
 *
 * The same statement also deletes the notifications older than `keepNotificationDays`, so the
 * cleanup costs no request of its own (the job has a budget of subrequests, ADR-029).
 */
export async function announceNewEpisodes(
  db: SqlExecutor,
  now: Date = new Date(),
): Promise<AnnounceSummary> {
  const windowStart = new Date(
    now.getTime() - announceWindowDays * 24 * 60 * 60 * 1000,
  );
  const cutoff = new Date(
    now.getTime() - keepNotificationDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { rows } = await db.execute(sql`
    WITH due AS (
      UPDATE media_next_episode
      SET announced_stamp = air_stamp
      WHERE air_stamp IS NOT NULL
        AND air_stamp <= ${now.toISOString()}::timestamptz
        AND air_stamp > ${windowStart.toISOString()}::timestamptz
        AND (announced_stamp IS NULL OR announced_stamp < air_stamp)
      RETURNING media_id, season, number, air_stamp
    ),
    listeners AS (
      SELECT u.id AS user_id, u.locale, due.media_id, due.season, due.number, due.air_stamp,
             coalesce(nullif(m.titles ->> u.locale, ''), m.title) AS title
      FROM due
      JOIN media_items m ON m.id = due.media_id
      JOIN library_entries le
        ON le.media_id = due.media_id AND le.status = 'in_progress' AND le.notify_new_episodes
      JOIN users u ON u.id = le.user_id
    ),
    notified AS (
      INSERT INTO notifications (user_id, type, payload, dedupe_key)
      SELECT user_id,
             ${episodeAiredEvent}::text,
             jsonb_build_object(
               'locale', locale, 'mediaId', media_id, 'title', title,
               'season', season, 'number', number
             ),
             'episode:' || media_id::text || ':' || air_stamp::text
      FROM listeners
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING id
    ),
    pruned AS (
      DELETE FROM notifications
      WHERE created_at < ${cutoff}::timestamptz
      RETURNING 1
    ),
    heard AS (
      SELECT e.id AS endpoint_id, l.locale, l.media_id, l.season, l.number, l.air_stamp, l.title
      FROM listeners l
      JOIN webhook_endpoints e
        ON e.user_id = l.user_id AND e.enabled
       AND ${episodeAiredEvent}::text = ANY (e.event_types)
    ),
    ranked AS (
      SELECT heard.*,
             row_number() OVER (PARTITION BY endpoint_id ORDER BY title, media_id) AS pos,
             count(*) OVER (PARTITION BY endpoint_id) AS total
      FROM heard
    ),
    queued AS (
      INSERT INTO outbox (type, payload, idempotency_key, endpoint_id)
      SELECT ${episodeAiredEvent}::text,
             jsonb_build_object(
               'locale', max(locale),
               'total', max(total),
               'episodes', jsonb_agg(
                 jsonb_build_object('title', title, 'season', season, 'number', number)
                 ORDER BY pos
               ) FILTER (WHERE pos <= ${maxTitlesPerMessage}::int)
             ),
             'episodes:' || endpoint_id::text || ':'
               || md5(string_agg(media_id::text || '@' || air_stamp::text, ',' ORDER BY media_id)),
             endpoint_id
      FROM ranked
      GROUP BY endpoint_id
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT count(*) FROM due)::int AS episodes,
           (SELECT count(*) FROM queued)::int AS messages,
           (SELECT count(*) FROM notified)::int AS notifications,
           (SELECT count(*) FROM pruned)::int AS pruned
  `);
  return {
    episodes: Number(rows[0]?.episodes ?? 0),
    messages: Number(rows[0]?.messages ?? 0),
    notifications: Number(rows[0]?.notifications ?? 0),
  };
}
