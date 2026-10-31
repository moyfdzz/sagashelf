import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { mediaItems } from "./media";
import { type LocalizedText, timestamps } from "./shared";

/**
 * A thing Wikidata knows (CC0), kept as far as the "other formats" of a title need it (SAG-16,
 * ADR-025): its name in each language, what format it is, and the ids it has in sources we use.
 * The row is catalog data, not a person's, so the account erasure does not touch it.
 */
export const wikidataItems = pgTable(
  "wikidata_items",
  {
    // `Q586025`.
    qid: text("qid").primaryKey(),
    labels: jsonb("labels")
      .$type<LocalizedText>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // `anime`, `movie`, `series`, `manga`, `book`, `game`, `franchise` or `other`. Checked in the
    // code, so a new format needs no migration.
    format: text("format").notNull().default("other"),
    // Keys `tmdb_movie`, `tmdb_tv`, `mal_manga`, `anilist_manga` and `open_library`.
    ids: jsonb("ids")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [
    check("wikidata_items_qid_check", sql`${t.qid} ~ '^Q[0-9]{1,12}$'`),
    check(
      "wikidata_items_labels_check",
      sql`jsonb_typeof(${t.labels}) = 'object' and jsonb_typeof(${t.ids}) = 'object'`,
    ),
  ],
);

/**
 * How two Wikidata items relate: `franchise` (the member belongs to the media franchise) and
 * `based_on` (the first is based on the second). There is no foreign key: a link can arrive
 * before the item at its end, and a page only shows the ones whose two ends are known.
 */
export const wikidataLinks = pgTable(
  "wikidata_links",
  {
    fromQid: text("from_qid").notNull(),
    toQid: text("to_qid").notNull(),
    relation: text("relation").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.fromQid, t.toQid, t.relation] }),
    check(
      "wikidata_links_relation_check",
      sql`${t.relation} in ('franchise', 'based_on')`,
    ),
    index("wikidata_links_to_idx").on(t.toQid, t.relation),
  ],
);

/**
 * That a title was looked up in Wikidata, and the item it is. A null `qid` says "asked, Wikidata
 * does not know it", which is asked again after 30 days. It is not a `media_external_ids` row:
 * that table needs one title per id, and a miss needs a place to be remembered.
 */
export const mediaWikidata = pgTable(
  "media_wikidata",
  {
    mediaId: uuid("media_id")
      .primaryKey()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    qid: text("qid"),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "media_wikidata_qid_check",
      sql`${t.qid} is null or ${t.qid} ~ '^Q[0-9]{1,12}$'`,
    ),
    index("media_wikidata_qid_idx").on(t.qid),
  ],
);
