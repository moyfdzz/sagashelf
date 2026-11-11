import {
  resultsAnswer,
  seasonDetailsAnswer,
  showSeasonsAnswer,
  titleAnswer,
} from "./schemas";
import { createHttpClient, ProviderError, type HttpClient } from "../http";
import { airedIn, simplifyTitle, type TmdbShowDates } from "./match";
import type {
  Locale,
  MediaProvider,
  NormalizedMedia,
  SearchOptions,
  TrendingWindow,
} from "../types";
import {
  mapParts,
  mapTitle,
  parseExternalId,
  tmdbLanguage,
  type TmdbKind,
  type TmdbSeasonDetail,
  type TmdbTitle,
} from "./map";

const baseUrl = "https://api.themoviedb.org/3";

// TMDB allows about 40 requests per second and says the number can change. Stay well under it.
const requestsPerSecond = 30;

// `append_to_response` takes up to 20 extra requests inside one: a series with 40 seasons costs
// 3 calls, not 41 (a Worker on the Free plan may make 50 subrequests per invocation).
const seasonsPerRequest = 20;

type Results = { results?: TmdbTitle[] };

/** Builds a TMDB URL. The token goes in a header, never in the URL. */
function url(path: string, params: Record<string, string>): string {
  return `${baseUrl}${path}?${new URLSearchParams(params)}`;
}

/**
 * TMDB through the `MediaProvider` interface: movies, series and anime (series and movies that
 * TMDB files under Animation and that were made in Japan). Non-commercial use only; the logo and
 * the notice below must be shown on the credits page (SAG-31). Terms read 2026-10-25.
 */
export function createTmdbProvider(http: HttpClient): MediaProvider {
  async function searchKind(
    kind: TmdbKind,
    query: string,
    locale: Locale,
    signal?: AbortSignal,
    /** Only for movies: TMDB keeps the ones released that year, so the first 3 are not the most popular. */
    releasedIn?: number,
  ): Promise<NormalizedMedia[]> {
    const data = await http.getJson<Results>(
      url(`/search/${kind}`, {
        query,
        language: tmdbLanguage[locale],
        include_adult: "false",
        page: "1",
        ...(releasedIn && kind === "movie"
          ? { primary_release_year: String(releasedIn) }
          : {}),
      }),
      { signal, schema: resultsAnswer },
    );
    return (data.results ?? []).map((raw) => mapTitle(kind, raw, locale));
  }

  /** Movies and series are asked for together, each with its own endpoint. */
  async function both<T>(ask: (kind: TmdbKind) => Promise<T[]>): Promise<T[]> {
    const answers = await Promise.allSettled([ask("movie"), ask("tv")]);
    const fulfilled = answers.filter((answer) => answer.status === "fulfilled");
    // One of the two failing still leaves the other; both failing is a failure.
    if (fulfilled.length === 0) {
      const failed = answers.find((answer) => answer.status === "rejected");
      throw failed?.reason ?? new ProviderError("tmdb", "network");
    }
    return fulfilled.flatMap((answer) => answer.value);
  }

  const wanted = (item: NormalizedMedia, type: SearchOptions["type"]) =>
    type === undefined || item.type === type;

  return {
    id: "tmdb",
    capabilities: {
      types: ["movie", "series", "anime"],
      parts: true,
      trending: true,
    },
    attribution: {
      name: "TMDB",
      url: "https://www.themoviedb.org",
      notice:
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    },

    async search(query, { type, locale, signal }) {
      const text = query.trim();
      if (text === "") return [];

      // Anime are inside both endpoints, so anime asks for both and keeps the ones it is.
      const items =
        type === "movie"
          ? await searchKind("movie", text, locale, signal)
          : type === "series"
            ? await searchKind("tv", text, locale, signal)
            : await both((kind) => searchKind(kind, text, locale, signal));
      return items.filter((item) => wanted(item, type));
    },

    async getById(externalId, { locale, signal }) {
      const parsed = parseExternalId(externalId);
      if (!parsed) return null;
      try {
        const raw = await http.getJson<TmdbTitle>(
          url(`/${parsed.kind}/${parsed.id}`, {
            language: tmdbLanguage[locale],
          }),
          { signal, schema: titleAnswer },
        );
        return mapTitle(parsed.kind, raw, locale);
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },

    async getParts(externalId, { signal } = {}) {
      const parsed = parseExternalId(externalId);
      // A movie has no parts.
      if (!parsed || parsed.kind !== "tv") return [];

      const show = await http.getJson<{ seasons?: TmdbSeasonDetail[] }>(
        url(`/tv/${parsed.id}`, { language: tmdbLanguage.en }),
        { signal, schema: showSeasonsAnswer },
      );
      const numbers = (show.seasons ?? []).map(
        (season) => season.season_number,
      );

      const detailed = new Map<number, TmdbSeasonDetail>();
      for (let start = 0; start < numbers.length; start += seasonsPerRequest) {
        const batch = numbers.slice(start, start + seasonsPerRequest);
        const data = await http.getJson<Record<string, TmdbSeasonDetail>>(
          url(`/tv/${parsed.id}`, {
            language: tmdbLanguage.en,
            append_to_response: batch
              .map((number) => `season/${number}`)
              .join(","),
          }),
          { signal, schema: seasonDetailsAnswer },
        );
        for (const number of batch) {
          const season = data[`season/${number}`];
          if (season) detailed.set(number, season);
        }
      }

      // A season TMDB did not detail still counts, without its episodes.
      const seasons = (show.seasons ?? []).map(
        (season) => detailed.get(season.season_number) ?? season,
      );
      return mapParts(seasons);
    },

    async matchByYear({ title, kind, year }, { locale, signal }) {
      const text = title.trim();
      if (text === "") return null;
      const simpler = simplifyTitle(text);
      // The plain title first; the shorter one only when the first finds nothing that fits.
      for (const query of simpler === text ? [text] : [text, simpler]) {
        // Only anime: it is what the other tracker lists here, and a name that fits no anime must
        // not land on an unrelated series that happened to air that year.
        const found = (await searchKind(kind, query, locale, signal, year))
          .filter((item) => item.type === "anime")
          .slice(0, 3);
        const checked = await Promise.all(
          found.map(async (item): Promise<string | null> => {
            const id = item.externalId.id;
            // A movie has one date, and the search already sends it.
            if (kind === "movie") return item.year === year ? id : null;
            const numeric = parseExternalId(id)?.id;
            if (numeric === undefined) return null;
            try {
              const show = await http.getJson<TmdbShowDates>(
                url(`/tv/${numeric}`, {}),
                { signal },
              );
              return airedIn(show, year) ? id : null;
            } catch (error) {
              // A series that vanished meanwhile is not a fit; any other failure is a try again.
              if (error instanceof ProviderError && error.status === 404) {
                return null;
              }
              throw error;
            }
          }),
        );
        const fits = checked.filter((id): id is string => id !== null);
        // Two series that fit are a guess: better left for the person than a wrong title.
        if (fits.length > 1) return null;
        if (fits[0]) return fits[0];
      }
      return null;
    },

    async trending(window: TrendingWindow, { type, locale, signal }) {
      const path =
        type === "movie"
          ? "movie"
          : type === "series" || type === "anime"
            ? "tv"
            : "all";
      const data = await http.getJson<Results>(
        url(`/trending/${path}/${window}`, {
          language: tmdbLanguage[locale],
        }),
        { signal, schema: resultsAnswer },
      );
      return (data.results ?? [])
        .filter((raw) => raw.media_type !== "person")
        .map((raw) => {
          const kind: TmdbKind =
            path === "all" ? (raw.media_type === "tv" ? "tv" : "movie") : path;
          return mapTitle(kind, raw, locale);
        })
        .filter((item) => wanted(item, type));
    },
  };
}

/** The TMDB provider with its read access token (a Workers secret) and its limits. */
export function createTmdbProviderWithToken(
  token: string,
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
): MediaProvider {
  return createTmdbProvider(
    createHttpClient({
      provider: "tmdb",
      headers: { Authorization: `Bearer ${token}` },
      ratePerSecond: requestsPerSecond,
      ...overrides,
    }),
  );
}
