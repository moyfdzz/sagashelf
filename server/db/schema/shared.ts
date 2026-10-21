import { sql } from "drizzle-orm";
import { customType, pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";

// Schema files use relative imports on purpose: drizzle-kit reads them outside Vite.

/** Case-insensitive text (the `citext` extension). Used for values like usernames. */
export const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

/** Full-text search document. Always a generated column, never written by the app. */
export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/** Primary key: a time-ordered UUID made by Postgres 18's built-in `uuidv7()`. */
export const primaryId = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** The same three levels for a profile and for what a person shares. */
export const privacyLevel = pgEnum("privacy_level", [
  "public",
  "friends",
  "private",
]);

export const userRole = pgEnum("user_role", ["user", "moderator", "admin"]);

export const mediaType = pgEnum("media_type", [
  "anime",
  "movie",
  "series",
  "book",
  "manga",
  "custom",
]);

export const mediaStatus = pgEnum("media_status", [
  "upcoming",
  "ongoing",
  "finished",
  "cancelled",
  "unknown",
]);

/** Where an external id comes from. `isbn` is stored here too so books can be matched across sources. */
export const externalProvider = pgEnum("external_provider", [
  "tmdb",
  "tvmaze",
  "wikidata",
  "open_library",
  "google_books",
  "mangadex",
  "isbn",
]);

export const partKind = pgEnum("part_kind", [
  "season",
  "episode",
  "volume",
  "chapter",
]);

export const sagaRole = pgEnum("saga_role", [
  "original",
  "adaptation",
  "sequel",
  "prequel",
  "spin_off",
  "other",
]);

export const libraryStatus = pgEnum("library_status", [
  "planned",
  "in_progress",
  "completed",
  "paused",
  "dropped",
]);

/** Text per language, for example `{ "es": "...", "en": "..." }`. */
export type LocalizedText = Partial<Record<"es" | "en", string>>;
