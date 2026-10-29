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
    // What `progress` counts for a book or a manga, and how many of them the person's edition
    // has. Both are empty for titles whose total comes from the catalog (episodes).
    progressUnit: text("progress_unit", {
      enum: ["pages", "chapters", "volumes"],
    }),
    progressTotal: integer("progress_total"),
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
      "library_entries_progress_unit_check",
      sql`${t.progressUnit} is null or ${t.progressUnit} in ('pages', 'chapters', 'volumes')`,
    ),
    // A total only makes sense in a unit, and progress never passes it.
    check(
      "library_entries_progress_total_check",
      sql`${t.progressTotal} is null or (${t.progressTotal} > 0 and ${t.progressUnit} is not null and ${t.progress} <= ${t.progressTotal})`,
    ),
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

/**
 * A time a person finished watching a title, before the one the entry holds now. The entry keeps
 * the dates of the current run; "Watch it again" and the editor add the earlier ones here. The
 * dates are optional: somebody may remember they saw it and not when. The rows belong to the
 * entry, so removing the entry or the account removes them.
 */
export const libraryViewings = pgTable(
  "library_viewings",
  {
    id: primaryId(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => libraryEntries.id, { onDelete: "cascade" }),
    startedOn: date("started_on"),
    finishedOn: date("finished_on"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    check(
      "library_viewings_dates_check",
      sql`${t.startedOn} is null or ${t.finishedOn} is null or ${t.finishedOn} >= ${t.startedOn}`,
    ),
    check(
      "library_viewings_notes_length_check",
      sql`char_length(${t.notes}) <= 500`,
    ),
    index("library_viewings_entry_idx").on(t.entryId),
  ],
);
