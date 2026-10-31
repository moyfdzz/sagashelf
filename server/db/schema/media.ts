import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  externalProvider,
  type LocalizedText,
  mediaStatus,
  mediaType,
  partKind,
  primaryId,
  timestamps,
  tsvector,
} from "./shared";

/** One title in the catalog, whatever its source or format. */
export const mediaItems = pgTable(
  "media_items",
  {
    id: primaryId(),
    type: mediaType("type").notNull(),
    title: text("title").notNull(),
    // The title in each language we have asked the source for. `title` is the one saved last: it
    // feeds the search and is the fallback when a language is missing here.
    titles: jsonb("titles")
      .$type<LocalizedText>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    originalTitle: text("original_title"),
    year: smallint("year"),
    synopsis: jsonb("synopsis")
      .$type<LocalizedText>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // The authors, in the order the source lists them (SAG-14). Null when the source has none;
    // a refresh that brings none never erases the ones we hold.
    creators: jsonb("creators").$type<string[]>(),
    // Minutes of a movie, or of a typical episode of a series (SAG-61). Null: never asked the
    // source. 0: asked, and the source does not know it (a refresh reads that as "done"). The
    // statistics count a title with 0 as one without a duration.
    runtimeMinutes: integer("runtime_minutes"),
    // The genres of our own list (SAG-71, ADR-024), as keys. Null: never asked the source. An
    // empty list: asked, and none of ours fits. A refresh that brings none never erases the ones we
    // hold. The keys are checked in the code, so a new genre needs no migration.
    genres: jsonb("genres").$type<string[]>(),
    // Ids this title has in other catalogs, for the Wikidata lookup (SAG-16): `mal` and `anilist`
    // for a manga of MangaDex. Null: never asked the source. An empty object: asked, none given.
    crossIds: jsonb("cross_ids").$type<Record<string, string>>(),
    imageUrl: text("image_url"),
    status: mediaStatus("status").notNull().default("unknown"),
    popularity: real("popularity").notNull().default(0),
    // When a provider last gave us this row. TMDB lets us keep what it sends for 6 months at
    // most (ADR-016), so a row older than that must be refreshed or have its provider data
    // removed.
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Titles without accents, in the 'simple' configuration so every language is treated
    // alike. `immutable_unaccent` is created in the first migration: the extension's own
    // function is not allowed inside a generated column.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', immutable_unaccent(coalesce(title, '') || ' ' || coalesce(original_title, '')))`,
    ),
    ...timestamps,
  },
  (t) => [
    check(
      "media_items_runtime_check",
      sql`${t.runtimeMinutes} is null or ${t.runtimeMinutes} >= 0`,
    ),
    check(
      "media_items_genres_check",
      sql`${t.genres} is null or jsonb_typeof(${t.genres}) = 'array'`,
    ),
    check(
      "media_items_year_check",
      sql`${t.year} is null or ${t.year} between 1000 and 2200`,
    ),
    index("media_items_type_popularity_idx").on(t.type, t.popularity.desc()),
    index("media_items_cross_ids_idx").using(
      "gin",
      sql`${t.crossIds} jsonb_path_ops`,
    ),
    index("media_items_search_vector_idx").using("gin", t.searchVector),
    // The fuzzy title indexes (pg_trgm) are in the `search_indexes` migration.
  ],
);

/**
 * The ids a title has in each source. This is what lets two sources describe the same
 * title without it being stored twice: one (provider, external_id) pair belongs to one title.
 */
export const mediaExternalIds = pgTable(
  "media_external_ids",
  {
    id: primaryId(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    provider: externalProvider("provider").notNull(),
    externalId: text("external_id").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("media_external_ids_provider_external_id_unique").on(
      t.provider,
      t.externalId,
    ),
    index("media_external_ids_media_idx").on(t.mediaId),
  ],
);

/** Seasons and episodes of a series, volumes and chapters of a book or manga. */
export const mediaParts = pgTable(
  "media_parts",
  {
    id: primaryId(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    kind: partKind("kind").notNull(),
    // An episode points to its season. Seasons, volumes and chapters have no parent.
    parentId: uuid("parent_id").references((): AnyPgColumn => mediaParts.id, {
      onDelete: "cascade",
    }),
    number: integer("number").notNull(),
    title: text("title"),
    airDate: date("air_date"),
    ...timestamps,
  },
  (t) => [
    // NULLS NOT DISTINCT: two seasons with number 1 and no parent are the same row.
    unique("media_parts_media_kind_parent_number_unique")
      .on(t.mediaId, t.kind, t.parentId, t.number)
      .nullsNotDistinct(),
    check("media_parts_number_check", sql`${t.number} >= 0`),
    index("media_parts_parent_idx").on(t.parentId),
  ],
);
