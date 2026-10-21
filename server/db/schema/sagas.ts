import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaItems } from "./media";
import { type LocalizedText, primaryId, sagaRole, timestamps } from "./shared";

/** A story told across formats: the page that groups its books, films, series and manga. */
export const sagas = pgTable("sagas", {
  id: primaryId(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: jsonb("description").$type<LocalizedText>(),
  imageUrl: text("image_url"),
  ...timestamps,
});

export const sagaMembers = pgTable(
  "saga_members",
  {
    sagaId: uuid("saga_id")
      .notNull()
      .references(() => sagas.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    role: sagaRole("role").notNull().default("other"),
    // Reading or watching order inside the saga.
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // A title appears once in a saga.
    primaryKey({ columns: [t.sagaId, t.mediaId] }),
    index("saga_members_media_idx").on(t.mediaId),
  ],
);
