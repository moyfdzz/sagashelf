import type {
  Attribution,
  Locale,
  MediaKind,
  MediaProvider,
  NormalizedMedia,
  ProviderId,
  TrendingWindow,
} from "../providers/types";

/**
 * What the world is watching now (SAG-23, ADR-051): the trending list of TMDB for movies, series
 * and anime. Nothing here touches our database or a person's data, so the answer is the same for
 * everybody and a copy is kept at the edge for an hour. TMDB lets a copy live 6 months at most
 * (ADR-016), so an hour is far inside the limit. Books and manga have no list: Open Library needs
 * its own look at its terms, and MangaDex has no popularity.
 */

/** How long a copy of the answer is kept at the edge. */
export const trendingTtlSeconds = 60 * 60;

/** The most titles one list holds (TMDB answers 20 per page). */
export const worldwideSize = 20;

/** The logo of each source that has a list, served from our own origin (`/credits` draws it too). */
const logos: Partial<Record<ProviderId, string>> = { tmdb: "/tmdb-logo.svg" };

/** Who the list comes from, with what the source requires us to show next to it. */
export type WorldwideSource = Attribution & { logo: string };

/** A title of the list. Its link is decided by the page: it may or may not be in our database. */
export type WorldwideTitle = {
  provider: ProviderId;
  externalId: string;
  type: MediaKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  /** The address of the poster at the provider; the page shows it through the image proxy. */
  imageUrl: string | null;
};

export type WorldwideTrending =
  /** The list, possibly empty, and its source. */
  | { status: "ok"; titles: WorldwideTitle[]; source: WorldwideSource }
  /** The source did not answer: nothing is kept, so the next call asks again. */
  | { status: "unavailable" }
  /** No source has a list for this type. Also the answer without a TMDB token, since that provider is then not built. */
  | { status: "unsupported" };

const toTitle = (item: NormalizedMedia): WorldwideTitle => ({
  provider: item.externalId.provider,
  externalId: item.externalId.id,
  type: item.type,
  title: item.title,
  originalTitle: item.originalTitle,
  year: item.year,
  imageUrl: item.imageUrl,
});

// The cache is keyed by a made-up address on a host that never exists, like the search cache. The
// version changes when the shape of an answer does, so a copy in the old shape is not read.
const keyFor = (
  provider: ProviderId,
  type: MediaKind,
  window: TrendingWindow,
  locale: Locale,
): Request =>
  new Request(
    `https://trending-cache.sagashelf.internal/v1?${new URLSearchParams({ provider, type, window, locale })}`,
  );

async function readCopy(
  cache: Cache | null,
  key: Request,
): Promise<WorldwideTitle[] | null> {
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    const body = (await hit.json()) as { titles?: unknown };
    return Array.isArray(body?.titles)
      ? (body.titles as WorldwideTitle[])
      : null;
  } catch {
    // A broken copy is a miss.
    return null;
  }
}

async function keepCopy(
  cache: Cache | null,
  key: Request,
  titles: WorldwideTitle[],
): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(
      key,
      new Response(JSON.stringify({ titles }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${trendingTtlSeconds}`,
        },
      }),
    );
  } catch {
    // Not being able to keep a copy costs one more call to the source, nothing more.
  }
}

/**
 * The trending list of the first source that has one for the type. A copy kept at the edge is
 * used first; an empty list is kept too, so an empty answer is not asked again for an hour. A
 * failure of the source is not kept. It never throws.
 */
export async function getWorldwideTrending(options: {
  providers: readonly MediaProvider[];
  /** The Workers Cache API, or null when the runtime has none. */
  cache: Cache | null;
  type: MediaKind;
  window: TrendingWindow;
  locale: Locale;
  signal?: AbortSignal;
}): Promise<WorldwideTrending> {
  const { providers, cache, type, window, locale, signal } = options;
  const provider = providers.find(
    (candidate) =>
      candidate.capabilities.trending &&
      candidate.trending !== undefined &&
      candidate.capabilities.types.includes(type) &&
      candidate.id in logos,
  );
  const logo = provider ? logos[provider.id] : undefined;
  const ask = provider?.trending?.bind(provider);
  if (!provider || !logo || !ask) return { status: "unsupported" };

  const source: WorldwideSource = { ...provider.attribution, logo };
  const key = keyFor(provider.id, type, window, locale);

  const copy = await readCopy(cache, key);
  if (copy) return { status: "ok", titles: copy, source };

  try {
    const items = await ask(window, { type, locale, signal });
    const titles = items.slice(0, worldwideSize).map(toTitle);
    await keepCopy(cache, key, titles);
    return { status: "ok", titles, source };
  } catch {
    return { status: "unavailable" };
  }
}
