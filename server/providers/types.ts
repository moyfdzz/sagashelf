import type { LocalizedText } from "../db/schema/shared";

/** The kinds of title a provider can return. `custom` titles are made by people, not fetched. */
export type MediaKind = "anime" | "movie" | "series" | "book" | "manga";

export type Locale = "es" | "en";

export type MediaStatus =
  "upcoming" | "ongoing" | "finished" | "cancelled" | "unknown";

/** Where an external id comes from. The same names as the `external_provider` column. */
export type ProviderId =
  "tmdb" | "tvmaze" | "wikidata" | "open_library" | "google_books" | "mangadex";

/** One title in the shape the app uses, whichever source it came from. */
export type NormalizedMedia = {
  type: MediaKind;
  /** In the language that was asked for, when the source has it. */
  title: string;
  /**
   * The title in other languages, when the source gives one title and knows what it is in another
   * language. `title` is saved for the language that was asked for, and these are added to it.
   */
  titles?: LocalizedText;
  originalTitle: string | null;
  year: number | null;
  /**
   * Usually only the language that was asked for is filled. A source that has one text in a single
   * language (Open Library) fills that language whatever was asked.
   */
  synopsis: LocalizedText;
  /** Authors, in the order the source lists them. Left out when the source has none. */
  creators?: string[];
  /**
   * Minutes of a movie, or of a typical episode of a series. Left out when the source does not say.
   * For a series that gives the length per episode, `saveParts` replaces it with their average.
   */
  runtimeMinutes?: number;
  imageUrl: string | null;
  status: MediaStatus;
  popularity: number;
  /** The id in the source. One (provider, id) pair belongs to one title. */
  externalId: { provider: ProviderId; id: string };
};

/** A season or an episode of a series, a volume or a chapter of a book. */
export type NormalizedPart = {
  kind: "season" | "episode" | "volume" | "chapter";
  number: number;
  title: string | null;
  /** `YYYY-MM-DD`. */
  airDate: string | null;
  /** For an episode, its length in minutes when the source says it. */
  runtimeMinutes?: number;
  /** For an episode, the number of its season. */
  seasonNumber?: number;
};

export type Attribution = {
  name: string;
  url: string;
  /** The wording the source requires, in English. */
  notice: string;
};

export type SearchOptions = {
  /** Without a type, every kind the provider covers. */
  type?: MediaKind;
  locale: Locale;
  signal?: AbortSignal;
};

export type TrendingWindow = "day" | "week";

/** What every data source implements, so one can be added, removed or replaced alone. */
export interface MediaProvider {
  readonly id: ProviderId;
  readonly capabilities: {
    types: readonly MediaKind[];
    parts: boolean;
    trending: boolean;
  };
  readonly attribution: Attribution;

  search(query: string, options: SearchOptions): Promise<NormalizedMedia[]>;
  getById(
    externalId: string,
    options: { locale: Locale; signal?: AbortSignal },
  ): Promise<NormalizedMedia | null>;
  getParts(
    externalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<NormalizedPart[]>;
  trending?(
    window: TrendingWindow,
    options: SearchOptions,
  ): Promise<NormalizedMedia[]>;
}
