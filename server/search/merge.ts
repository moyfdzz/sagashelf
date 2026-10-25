import type {
  Locale,
  MediaKind,
  NormalizedMedia,
  ProviderId,
} from "../providers/types";
import { normalizeQuery, similarity } from "./normalize";

/** One line of the results: a title from our own database or from a provider. */
export type SearchResult = {
  /** Our id, when the title is already in the database. */
  id: string | null;
  provider: ProviderId;
  externalId: string;
  type: MediaKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  /** The synopsis in the language that was asked for, when there is one. */
  synopsis: string | null;
  /** The provider's address of the poster. The page shows it through the image proxy. */
  imageUrl: string | null;
  popularity: number;
  source: "local" | "provider";
};

export function toResult(
  item: NormalizedMedia,
  locale: Locale,
  source: SearchResult["source"],
  id: string | null = null,
): SearchResult {
  return {
    id,
    provider: item.externalId.provider,
    externalId: item.externalId.id,
    type: item.type,
    title: item.title,
    originalTitle: item.originalTitle,
    year: item.year,
    synopsis: item.synopsis[locale] ?? null,
    imageUrl: item.imageUrl,
    popularity: item.popularity,
    source,
  };
}

/** The same work under two sources has the same normalized title, year and kind. */
function identity(result: SearchResult): string {
  return `${result.type}|${normalizeQuery(result.title)}|${result.year ?? ""}`;
}

/**
 * Joins the answers of the database and of the providers into one list without repeats. A title
 * is the same when it has the same source id, or the same kind, title and year from another
 * source. The first one wins, and the database goes first, so a title we already hold keeps its id.
 */
export function mergeResults(
  ...lists: readonly (readonly SearchResult[])[]
): SearchResult[] {
  const byId = new Set<string>();
  const byIdentity = new Set<string>();
  const merged: SearchResult[] = [];

  for (const list of lists) {
    for (const result of list) {
      const sourceKey = `${result.provider}:${result.externalId}`;
      const identityKey = identity(result);
      if (byId.has(sourceKey) || byIdentity.has(identityKey)) continue;
      byId.add(sourceKey);
      byIdentity.add(identityKey);
      merged.push(result);
    }
  }
  return merged;
}

/**
 * Orders results: an exact title first, then the closest title, then the most popular, and
 * among equals the one that has text in the person's language. The sort is stable, so equal
 * results keep the order the sources gave them.
 */
export function rankResults(
  results: readonly SearchResult[],
  normalizedQuery: string,
): SearchResult[] {
  const scored = results.map((result) => {
    const title = normalizeQuery(result.title);
    const original = normalizeQuery(result.originalTitle ?? "");
    return {
      result,
      exact: title === normalizedQuery || original === normalizedQuery ? 1 : 0,
      close: Math.max(
        similarity(title, normalizedQuery),
        similarity(original, normalizedQuery),
      ),
      // The synopsis is already in the language that was asked for, or missing.
      language: result.synopsis !== null ? 1 : 0,
    };
  });
  return scored
    .sort(
      (a, b) =>
        b.exact - a.exact ||
        b.close - a.close ||
        b.result.popularity - a.result.popularity ||
        b.language - a.language,
    )
    .map((entry) => entry.result);
}
