/**
 * Pure helpers to match a title from another tracker (Simkl, SAG-243) to a TMDB series or movie by
 * name and year. Simkl lists each season of an anime on its own, with the year of that season, and
 * names it in romaji, so the plain title and year rarely find the series: TMDB holds one series
 * with seasons whose first year is earlier.
 */

/** A show as `GET /tv/{id}` sends it, reduced to what the match reads. */
export type TmdbShowDates = {
  first_air_date?: string;
  last_air_date?: string;
  seasons?: { air_date?: string | null }[];
};

const yearOf = (date: string | null | undefined): number | null => {
  const year = Number(/^(\d{4})/.exec(date ?? "")?.[1]);
  return Number.isInteger(year) && year > 0 ? year : null;
};

/**
 * The title without what a second search can drop: the subtitle after a colon and a trailing
 * season marker ("Season 3", "2nd Season", "II"). Returns the same text when there is nothing to
 * drop, so the caller can skip the second search.
 */
export function simplifyTitle(title: string): string {
  // A colon followed by a space starts a subtitle; "Re:Zero" has none and stays whole.
  const main = title.split(/:\s/)[0] ?? title;
  const simpler = main
    .replace(
      /\s+(season\s*\d+|\d+(st|nd|rd|th)\s+season|[2-9]|i{2,3}|iv)$/i,
      "",
    )
    .trim();
  return simpler === "" ? title.trim() : simpler;
}

/**
 * Whether a series aired in `year`: one of its seasons did, or the year is inside the range from
 * its first to its last episode (a series still on air has no last date, so its first year is the
 * only bound until it ends).
 */
export function airedIn(show: TmdbShowDates, year: number): boolean {
  if ((show.seasons ?? []).some((season) => yearOf(season.air_date) === year)) {
    return true;
  }
  const first = yearOf(show.first_air_date);
  if (first === null) return false;
  const last = yearOf(show.last_air_date) ?? first;
  return year >= first && year <= Math.max(first, last);
}
