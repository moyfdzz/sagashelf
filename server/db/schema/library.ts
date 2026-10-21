import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaItems } from "./media";
import { libraryStatus, primaryId, privacyLevel, timestamps } from "./shared";
import { users } from "./users";

/** What one person has done with one title: status, progress, score and notes. */
export const libraryEntries = pgTable(
  "library_entries",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    status: libraryStatus("status").notNull().default("planned"),
    progress: integer("progress").notNull().default(0),
    score: smallint("score"),
    startedAt: date("started_at"),
    finishedAt: date("finished_at"),
    rewatchCount: smallint("rewatch_count").notNull().default(0),
    notes: text("notes"),
    // Private until the person chooses otherwise.
    visibility: privacyLevel("visibility").notNull().default("private"),
    ...timestamps,
  },
  (t) => [
    unique("library_entries_user_media_unique").on(t.userId, t.mediaId),
    check("library_entries_progress_check", sql`${t.progress} >= 0`),
    check(
      "library_entries_score_check",
      sql`${t.score} is null or ${t.score} between 1 and 10`,
    ),
    check("library_entries_rewatch_check", sql`${t.rewatchCount} >= 0`),
    check(
      "library_entries_dates_check",
      sql`${t.startedAt} is null or ${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check(
      "library_entries_notes_length_check",
      sql`char_length(${t.notes}) <= 2000`,
    ),
    index("library_entries_user_status_idx").on(t.userId, t.status),
    // Partial index: what a visitor can see (public entries of a title) stays cheap to find.
    index("library_entries_public_media_idx")
      .on(t.mediaId)
      .where(sql`${t.visibility} = 'public'`),
  ],
);
