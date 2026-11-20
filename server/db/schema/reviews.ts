import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaItems } from "./media";
import { primaryId, privacyLevel, timestamps } from "./shared";
import { activity } from "./social";
import { users } from "./users";

/**
 * A review of a title by one person (SAG-22, ADR-053): plain text with its line breaks, an optional
 * spoiler mark and a level of its own, independent of the library entry. One per person and title.
 * The length is checked in code points (`char_length`), the same way the form counts it; the
 * numbers are the ones of `server/reviews/rules.ts`, which a test keeps equal.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    // The SHA-256 of the text lowercased with spaces and punctuation collapsed: a review is refused
    // when the same person already has this text on another title (ADR-053). Never shown.
    fingerprint: text("fingerprint").notNull(),
    spoiler: boolean("spoiler").notNull().default(false),
    visibility: privacyLevel("visibility").notNull(),
    // The `reviewed` event of the feed that carries its likes (ADR-056). Written in the same
    // statement as the review, and deleted in the same statement as the review: with no action on
    // delete, a statement that deleted the event and left the review fails instead.
    activityId: uuid("activity_id")
      .unique()
      .references(() => activity.id),
    // Set when a moderator removes the review (SAG-22, second pull request): it is then hidden from
    // everybody but its author, and kept as the evidence of the report.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("reviews_user_media_unique").on(t.userId, t.mediaId),
    check(
      "reviews_body_length_check",
      sql`char_length(${t.body}) BETWEEN 500 AND 5000`,
    ),
    check(
      "reviews_fingerprint_check",
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    // The reviews of one person: how many they wrote in the last hour, and the duplicate check.
    index("reviews_user_created_idx").on(t.userId, t.createdAt.desc()),
    // The reviews of one title, for its page.
    index("reviews_media_created_idx").on(t.mediaId, t.createdAt.desc()),
  ],
);
