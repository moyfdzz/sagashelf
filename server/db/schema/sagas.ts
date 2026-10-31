import { sql } from "drizzle-orm";
import {
  check,
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
  // The name in English, the fallback of `titles`.
  title: text("title").notNull(),
  // The name in each language (SAG-25): `{ "es": "...", "en": "..." }`.
  titles: jsonb("titles")
    .$type<LocalizedText>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  // A hash of the curated entry the saga was last saved from (`server/sagas/curated.ts`): the
  // sync saves a saga again only when the entry changed.
  sourceHash: text("source_hash"),
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

/**
 * The works of a saga as Wikidata items (SAG-25, ADR-026). A member can be a title our catalog
 * holds or only a name Wikidata knows, so it is kept by its item (`Q...`) and matched to the
 * catalog when a page is read. There is no foreign key to the item: it may arrive after the row.
 * `position` is the order of the story as curated; the release order comes from the year.
 */
export const sagaWikidataMembers = pgTable(
  "saga_wikidata_members",
  {
    sagaId: uuid("saga_id")
      .notNull()
      .references(() => sagas.id, { onDelete: "cascade" }),
    qid: text("qid").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.sagaId, t.qid] }),
    check("saga_wikidata_members_qid_check", sql`${t.qid} ~ '^Q[0-9]{1,12}$'`),
    index("saga_wikidata_members_qid_idx").on(t.qid),
  ],
);
