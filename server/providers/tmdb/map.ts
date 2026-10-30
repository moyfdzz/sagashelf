import type {
  Locale,
  MediaKind,
  MediaStatus,
  NormalizedMedia,
  NormalizedPart,
} from "../types";

/** The shapes TMDB sends, reduced to the fields that are read. */
export type TmdbTitle = {
  id: number;
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  genre_ids?: number[];
  genres?: { id: number }[];
  origin_country?: string[];
  original_language?: string;
  status?: string;
  media_type?: string;
  /** Minutes of a movie. */
  runtime?: number | null;
  /** Minutes of an episode of a series: TMDB sends a list, often empty. */
  episode_run_time?: number[];
};

export type TmdbSeason = {
  season_number: number;
  name?: string | null;
  air_date?: string | null;
};

export type TmdbEpisode = {
  episode_number: number;
  name?: string | null;
  air_date?: string | null;
  runtime?: number | null;
};

export type TmdbSeasonDetail = TmdbSeason & { episodes?: TmdbEpisode[] };

export type TmdbKind = "movie" | "tv";

/** TMDB asks for a language and a region: the Spanish of Mexico, the English of the US. */
export const tmdbLanguage: Record<Locale, string> = {
  es: "es-MX",
  en: "en-US",
};

// w500 is a poster size TMDB serves. The image proxy (SAG-17) picks other sizes from the path.
const imageBase = "https://image.tmdb.org/t/p/w500";

const animationGenre = 16;

/**
 * TMDB has no "anime" type: anime are movies and series with the Animation genre made in
 * Japan. The country is on series, the original language is the signal for movies.
 */
export function classify(kind: TmdbKind, title: TmdbTitle): MediaKind {
  const genres =
    title.genre_ids ?? title.genres?.map((genre) => genre.id) ?? [];
  const japanese =
    title.origin_country?.includes("JP") || title.original_language === "ja";
  if (genres.includes(animationGenre) && japanese) return "anime";
  return kind === "movie" ? "movie" : "series";
}

/** The id in our table. Movies and series have separate id spaces in TMDB, so the kind is kept. */
export function toExternalId(kind: TmdbKind, id: number): string {
  return `${kind}/${id}`;
}

export function parseExternalId(
  externalId: string,
): { kind: TmdbKind; id: number } | null {
  const match = /^(movie|tv)\/(\d{1,9})$/.exec(externalId);
  return match ? { kind: match[1] as TmdbKind, id: Number(match[2]) } : null;
}

function yearOf(date: string | undefined): number | null {
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 2200 ? year : null;
}

function statusOf(status: string | undefined): MediaStatus {
  switch (status) {
    case "Returning Series":
      return "ongoing";
    case "Ended":
    case "Released":
      return "finished";
    case "Canceled":
      return "cancelled";
    case "Planned":
    case "In Production":
    case "Post Production":
    case "Rumored":
      return "upcoming";
    default:
      return "unknown";
  }
}

/** A length in minutes that makes sense; TMDB sends 0 or null for the ones it does not know. */
const minutesOrUndefined = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;

/** The length of an episode of a series, from the list TMDB sends: their average. */
function episodeMinutes(list: number[] | undefined): number | undefined {
  const known = (list ?? []).filter((v) => minutesOrUndefined(v));
  return known.length
    ? Math.round(known.reduce((sum, v) => sum + v, 0) / known.length)
    : undefined;
}

const textOrNull = (value: string | null | undefined) =>
  value && value.trim() !== "" ? value.trim() : null;

/** One TMDB movie or series as a title of ours, in the language that was asked for. */
export function mapTitle(
  kind: TmdbKind,
  raw: TmdbTitle,
  locale: Locale,
): NormalizedMedia {
  const title =
    textOrNull(kind === "movie" ? raw.title : raw.name) ??
    textOrNull(kind === "movie" ? raw.original_title : raw.original_name) ??
    "";
  const original = textOrNull(
    kind === "movie" ? raw.original_title : raw.original_name,
  );
  const overview = textOrNull(raw.overview);
  const runtimeMinutes =
    kind === "movie"
      ? minutesOrUndefined(raw.runtime)
      : episodeMinutes(raw.episode_run_time);

  return {
    type: classify(kind, raw),
    title,
    originalTitle: original && original !== title ? original : null,
    year: yearOf(kind === "movie" ? raw.release_date : raw.first_air_date),
    synopsis: overview ? { [locale]: overview } : {},
    imageUrl: raw.poster_path ? `${imageBase}${raw.poster_path}` : null,
    status: statusOf(raw.status),
    popularity: raw.popularity ?? 0,
    ...(runtimeMinutes ? { runtimeMinutes } : {}),
    externalId: { provider: "tmdb", id: toExternalId(kind, raw.id) },
  };
}

/** The seasons of a series, and the episodes of each one. */
export function mapParts(seasons: TmdbSeasonDetail[]): NormalizedPart[] {
  return seasons.flatMap((season) => [
    {
      kind: "season" as const,
      number: season.season_number,
      title: textOrNull(season.name),
      airDate: textOrNull(season.air_date),
    },
    ...(season.episodes ?? []).map((episode) => {
      const runtimeMinutes = minutesOrUndefined(episode.runtime);
      return {
        kind: "episode" as const,
        number: episode.episode_number,
        title: textOrNull(episode.name),
        airDate: textOrNull(episode.air_date),
        seasonNumber: season.season_number,
        ...(runtimeMinutes ? { runtimeMinutes } : {}),
      };
    }),
  ]);
}
