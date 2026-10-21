import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaItems } from "./media";
import { primaryId, privacyLevel, timestamps } from "./shared";
import { users } from "./users";

export const moderationState = pgEnum("moderation_state", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * A title a person added because the catalog does not have it. The title itself is a row in
 * `media_items` (type `custom`), so it can be tracked and listed like any other; this row says
 * who made it, who can see it, and whether a moderator has approved it.
 */
export const customEntries = pgTable(
  "custom_entries",
  {
    id: primaryId(),
    mediaId: uuid("media_id")
      .notNull()
      .unique()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Private until the owner shares it, and never public before a moderator approves it (app rule).
    visibility: privacyLevel("visibility").notNull().default("private"),
    moderationState: moderationState("moderation_state")
      .notNull()
      .default("pending"),
    ...timestamps,
  },
  (t) => [
    index("custom_entries_owner_idx").on(t.ownerId),
    // The moderation queue: what still needs a decision.
    index("custom_entries_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.moderationState} = 'pending'`),
  ],
);

/** A custom list of titles ("Best sci-fi", "To watch with friends"). */
export const lists = pgTable(
  "lists",
  {
    id: primaryId(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    visibility: privacyLevel("visibility").notNull().default("private"),
    ...timestamps,
  },
  (t) => [
    unique("lists_owner_title_unique").on(t.ownerId, t.title),
    check(
      "lists_title_length_check",
      sql`char_length(${t.title}) between 1 and 100`,
    ),
    check(
      "lists_description_length_check",
      sql`char_length(${t.description}) <= 500`,
    ),
    index("lists_public_idx")
      .on(t.createdAt)
      .where(sql`${t.visibility} = 'public'`),
  ],
);

export const listItems = pgTable(
  "list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    // A title appears once in a list.
    primaryKey({ columns: [t.listId, t.mediaId] }),
    check("list_items_note_length_check", sql`char_length(${t.note}) <= 500`),
    index("list_items_media_idx").on(t.mediaId),
  ],
);
