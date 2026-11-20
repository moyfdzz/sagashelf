import { sql, type SQL } from "drizzle-orm";

import type { ActivityEvent } from "../library/activity";

/**
 * The CTEs that write the activity of one library change (SAG-44, ADR-054), to put after a CTE named
 * `written` that changed the entry and returns its `user_id` and `visibility`. They are part of the
 * writer's statement, so an event is written if and only if the change was: a change that lost the
 * race of the version leaves `written` empty, and then nothing here writes either.
 *
 * The level of an event is the **strictest** of the entry (after the change) and the profile.
 * `privacy_level` is a Postgres enum declared as public, friends, private, and an enum compares by
 * that order, so `GREATEST` is the strictest (a test on the real Postgres keeps it so). Readers check
 * the current levels again: this one is only the most the event may ever show.
 *
 * A daily event (`progressed`, `rated`) updates the one of the same kind, person and title written
 * since midnight UTC, if there is one, and is added only when there is none. The update keeps the
 * id, so the likes of the event stay with it, and moves `created_at` so it is fresh in the feed.
 */
export function activityCtes(
  userId: string,
  mediaId: string,
  events: readonly ActivityEvent[],
): SQL {
  if (events.length === 0) return sql``;
  const parts = events.map((event, index) => {
    const payload = JSON.stringify(event.payload);
    const added = sql.raw(`activity_added_${index}`);
    if (!event.daily) {
      return sql`,
    ${added} AS (
      INSERT INTO activity (actor_id, type, media_id, payload, visibility)
      SELECT ${userId}::uuid, ${event.type}::activity_type, ${mediaId}::uuid, ${payload}::jsonb, visibility
      FROM activity_level
    )`;
    }
    const merged = sql.raw(`activity_merged_${index}`);
    return sql`,
    ${merged} AS (
      UPDATE activity
      SET payload = ${payload}::jsonb, visibility = (SELECT visibility FROM activity_level),
          created_at = now()
      WHERE id = (
        SELECT id FROM activity
        WHERE actor_id = ${userId}::uuid AND media_id = ${mediaId}::uuid
          AND type = ${event.type}::activity_type
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ORDER BY created_at DESC
        LIMIT 1
      )
        AND EXISTS (SELECT 1 FROM activity_level)
      RETURNING id
    ),
    ${added} AS (
      INSERT INTO activity (actor_id, type, media_id, payload, visibility)
      SELECT ${userId}::uuid, ${event.type}::activity_type, ${mediaId}::uuid, ${payload}::jsonb, visibility
      FROM activity_level
      WHERE NOT EXISTS (SELECT 1 FROM ${merged})
    )`;
  });
  return sql`,
    activity_level AS (
      SELECT GREATEST(written.visibility, users.privacy) AS visibility
      FROM written JOIN users ON users.id = written.user_id
    )${sql.join(parts, sql``)}`;
}
