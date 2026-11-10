import type { LibraryStatus } from "./schema";

/**
 * Reads a Simkl JSON backup (`SimklBackup.json`: the lists `shows`, `anime` and `movies`) and turns
 * each entry into the shape of our own export, so it goes through the same checks and the same
 * queue (SAG-242). The file is data from outside: only the fields named here are read, each one is
 * checked by its type, and anything else in it (posters, slugs, other people's ids) is left alone.
 *
 * Only the TMDB id is used. TMDB is the one source of ours that holds series, movies and anime
 * (ADR-005); the MyAnimeList, AniList and AniDB ids Simkl gives cannot be asked of any provider we
 * have. An entry without a TMDB id is left without a source, and the caller lists it as skipped.
 */

const statusOf: Record<string, LibraryStatus> = {
  completed: "completed",
  plantowatch: "planned",
  watching: "in_progress",
  hold: "paused",
  dropped: "dropped",
};

const sections = ["shows", "anime", "movies"] as const;
type Section = (typeof sections)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A Simkl backup has at least one of its lists and none of the keys of our own export. */
export function isSimklBackup(json: unknown): json is Record<string, unknown> {
  return (
    isRecord(json) &&
    !("libraryEntries" in json) &&
    sections.some((section) => Array.isArray(json[section]))
  );
}

/** The raw entries of every list, before any limit is applied: one count, no copies. */
export function simklEntryCount(json: Record<string, unknown>): number {
  return sections.reduce((total, section) => {
    const list = json[section];
    return total + (Array.isArray(list) ? list.length : 0);
  }, 0);
}

/** `2023-05-01T10:00:00Z` becomes `2023-05-01`; anything that does not start like a date is none. */
function dayOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value);
  return match?.[1] ?? null;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;

/** A TMDB id is a number in the file, or text in a few; anything else is no id. */
function tmdbIdOf(ids: unknown): string | null {
  if (!isRecord(ids)) return null;
  const value = ids.tmdb;
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return /^[1-9]\d{0,8}$/.test(text) ? text : null;
}

/**
 * TMDB numbers movies and series apart, so the same number can be two titles. Simkl says which an
 * anime is: a `movie` is a movie, and a series, an OVA or an ONA is a series on TMDB.
 */
function kindOf(section: Section, entry: Record<string, unknown>) {
  if (section === "movies") return "movie";
  if (section === "anime" && entry.anime_type === "movie") return "movie";
  return "tv";
}

function titleWithYear(title: string, year: unknown): string {
  return typeof year === "number" && Number.isInteger(year) && year > 0
    ? `${title} (${year})`
    : title;
}

/** One entry in the shape `importEntrySchema` reads. A missing `source` marks "no usable id". */
function convertEntry(
  section: Section,
  entry: unknown,
): Record<string, unknown> {
  if (!isRecord(entry)) return {};
  const item = isRecord(entry[section === "movies" ? "movie" : "show"])
    ? (entry[section === "movies" ? "movie" : "show"] as Record<
        string,
        unknown
      >)
    : {};
  const title =
    typeof item.title === "string" ? item.title.trim().slice(0, 300) : "";
  const tmdb = tmdbIdOf(item.ids);
  const status = typeof entry.status === "string" ? entry.status : "";
  const completed = statusOf[status] === "completed";
  const rating = entry.user_rating;

  return {
    // The year only helps a person find a skipped title by hand: a title we can read keeps its own.
    title: tmdb ? title : titleWithYear(title, item.year),
    ...(tmdb
      ? {
          source: { provider: "tmdb", id: `${kindOf(section, entry)}/${tmdb}` },
        }
      : {}),
    status: statusOf[status],
    // Episodes watched. A movie has none; the importer caps it by the real total of the title.
    progress: section === "movies" ? 0 : count(entry.watched_episodes_count),
    progressUnit: null,
    progressTotal: null,
    score:
      typeof rating === "number" &&
      Number.isInteger(rating) &&
      rating >= 1 &&
      rating <= 10
        ? rating
        : null,
    // Simkl has no start date (its "added" date is not one) and no notes.
    startedAt: null,
    finishedAt: completed ? dayOf(entry.last_watched_at) : null,
    notes: null,
    // An import never makes anything public, and Simkl has no such setting.
    visibility: "private",
  };
}

/** Every entry of the three lists, converted. The caller checks, dedupes and lists the rest. */
export function convertSimklBackup(
  json: Record<string, unknown>,
): Record<string, unknown>[] {
  const converted: Record<string, unknown>[] = [];
  for (const section of sections) {
    const list = json[section];
    if (!Array.isArray(list)) continue;
    for (const entry of list) converted.push(convertEntry(section, entry));
  }
  return converted;
}
