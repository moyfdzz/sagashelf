/**
 * The genres a title can have (SAG-71, ADR-024): a fixed list of ours, the same for every source.
 * Each provider maps what it sends to these keys and drops the rest, so a provider's own tags are
 * never stored. The names a person reads are in the locale files under `genres`, in both languages.
 * Adding a genre is a line here and its two names; it needs no migration.
 */
export const genres = [
  "action",
  "adventure",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "family",
  "fantasy",
  "historical",
  "horror",
  "music",
  "mystery",
  "psychological",
  "romance",
  "sci_fi",
  "slice_of_life",
  "sports",
  "thriller",
  "war",
  "western",
  "biography",
  "boys_love",
  "cooking",
  "girls_love",
  "harem",
  "isekai",
  "magical_girl",
  "martial_arts",
  "mecha",
  "medical",
  "military",
  "philosophical",
  "post_apocalyptic",
  "reincarnation",
  "samurai",
  "school_life",
  "superhero",
  "supernatural",
  "survival",
  "time_travel",
  "tragedy",
  "vampire",
  "video_games",
  "wuxia",
  "zombie",
  "news",
  "reality",
  "soap_opera",
  "talk_show",
] as const;

export type Genre = (typeof genres)[number];

const known: ReadonlySet<string> = new Set(genres);

export const isGenre = (value: unknown): value is Genre =>
  typeof value === "string" && known.has(value);

/** The genres once each, in the order they were found. Only the ones of the list are kept. */
export function uniqueGenres(found: readonly (Genre | undefined)[]): Genre[] {
  return [...new Set(found.filter(isGenre))];
}
