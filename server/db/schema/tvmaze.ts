import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaItems } from "./media";

/**
 * The next episode of a series or an anime, as TVmaze says it (SAG-90, ADR-027). TVmaze is
 * CC BY-SA and the page that shows it credits TVmaze. The row is catalog data, not a person's, so
 * the account erasure does not touch it. It is the table that the alerts of new episodes (SAG-28)
 * read.
 */
export const mediaNextEpisode = pgTable(
  "media_next_episode",
  {
    mediaId: uuid("media_id")
      .primaryKey()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    // The id of the show in TVmaze, which Wikidata gave (`media_wikidata.tvmaze_id`).
    tvmazeId: integer("tvmaze_id").notNull(),
    // `Running`, `Ended`, `To Be Determined` or `In Development`, as TVmaze writes them.
    showStatus: text("show_status"),
    // The day the next episode comes out, in the time of its network (`YYYY-MM-DD`). Null: TVmaze
    // knows of no next episode.
    airDate: date("air_date"),
    airStamp: timestamp("air_stamp", { withTimezone: true }),
    season: smallint("season"),
    number: smallint("number"),
    episodeName: text("episode_name"),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When the show is asked about again: the day after the next episode, or a week, or three
    // months, by what TVmaze said. It is how the job picks what to ask, with no list to keep.
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "media_next_episode_numbers_check",
      sql`(${t.season} is null or ${t.season} >= 0) and (${t.number} is null or ${t.number} >= 0)`,
    ),
    index("media_next_episode_check_idx").on(t.nextCheckAt),
  ],
);
