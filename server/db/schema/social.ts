import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaItems } from "./media";
import { primaryId, privacyLevel } from "./shared";
import { users } from "./users";

/** Following is one-way. Two people are friends when each follows the other (computed, not stored). */
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One follow per pair of people.
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    check("follows_not_self_check", sql`${t.followerId} <> ${t.followeeId}`),
    // "Who follows this person", for follower counts and lists.
    index("follows_followee_idx").on(t.followeeId),
  ],
);

/** A block hides each person from the other. The app checks it before any social read. */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    check("blocks_not_self_check", sql`${t.blockerId} <> ${t.blockedId}`),
    index("blocks_blocked_idx").on(t.blockedId),
  ],
);

export const activityType = pgEnum("activity_type", [
  "started",
  "progressed",
  "completed",
  "dropped",
  "rated",
  "list_created",
]);

/** What a person did, for the activity feed. Rows are never edited, so there is no `updated_at`. */
export const activity = pgTable(
  "activity",
  {
    id: primaryId(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: activityType("type").notNull(),
    mediaId: uuid("media_id").references(() => mediaItems.id, {
      onDelete: "cascade",
    }),
    // Small details of the event (for example the score or the episode), never anything private.
    payload: jsonb("payload")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Private unless the person's settings say otherwise (decided when the event is written).
    visibility: privacyLevel("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One person's recent activity.
    index("activity_actor_created_idx").on(t.actorId, t.createdAt.desc()),
    // The public feed.
    index("activity_public_feed_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.visibility} = 'public'`),
  ],
);

export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activity.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One like per person and event.
    primaryKey({ columns: [t.userId, t.activityId] }),
    index("likes_activity_idx").on(t.activityId),
  ],
);
