import type { SqlExecutor } from "../db/clerk-sync";
import {
  getSiteFavorites,
  type Period,
  type SiteFavorites,
} from "../db/site-favorites";
import type { StatsType } from "../db/stats";
import type { Locale, MediaProvider } from "../providers/types";
import { edgeKey, withEdgeCopy } from "./edge-copy";
import { getWorldwideTrending, type WorldwideTrending } from "./worldwide";

/** How long a copy of the favorites of the site is kept at the edge (ADR-051). */
export const favoritesTtlSeconds = 60 * 60;

export type TrendingPage = {
  favorites: SiteFavorites;
  /** Always the last week: TMDB offers the day and the week only. */
  worldwide: WorldwideTrending;
};

const isFavorites = (body: unknown): SiteFavorites | null => {
  const lists = body as Partial<Record<keyof SiteFavorites, unknown>> | null;
  return lists &&
    Array.isArray(lists.mostAdded) &&
    Array.isArray(lists.mostCompleted) &&
    Array.isArray(lists.bestRated)
    ? (lists as SiteFavorites)
    : null;
};

/**
 * The favorites of the site for a type and a period, with the copy of one hour at the edge. The
 * copy holds only public things counted for everybody, never what one person sees, so a person who
 * makes an entry private or deletes the account leaves the page within the hour (ADR-051). The
 * copy is one for each type, window and language, since the titles come in the language asked.
 */
export function getCachedSiteFavorites(
  db: SqlExecutor,
  cache: Cache | null,
  type: StatsType,
  period: Period,
  locale: Locale,
): Promise<SiteFavorites> {
  return withEdgeCopy({
    cache,
    key: edgeKey("favorites", "v1", {
      type,
      from: period.from,
      to: period.to,
      locale,
    }),
    seconds: favoritesTtlSeconds,
    parse: isFavorites,
    load: () => getSiteFavorites(db, type, period, locale),
  });
}

/** Everything the page shows: the two lists at once, each with its own copy at the edge. */
export async function loadTrendingPage(options: {
  db: SqlExecutor;
  cache: Cache | null;
  providers: readonly MediaProvider[];
  type: StatsType;
  period: Period;
  locale: Locale;
  signal?: AbortSignal;
}): Promise<TrendingPage> {
  const { db, cache, providers, type, period, locale, signal } = options;
  const [favorites, worldwide] = await Promise.all([
    getCachedSiteFavorites(db, cache, type, period, locale),
    getWorldwideTrending({
      providers,
      cache,
      type,
      window: "week",
      locale,
      signal,
    }),
  ]);
  return { favorites, worldwide };
}
