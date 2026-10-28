import { z } from "zod";

import type { MediaKind } from "../providers/types";

export const queryMinLength = 2;
export const queryMaxLength = 100;

/** The kinds the search offers today. Books and manga join when their providers exist (SAG-14). */
export const searchTypes = [
  "anime",
  "movie",
  "series",
  "book",
  "manga",
] as const;
export type SearchType = (typeof searchTypes)[number];

// The kinds a provider-less search can still be asked for, for the database part.
export const mediaKindsOf = (type: SearchType | undefined): MediaKind[] =>
  type ? [type] : [...searchTypes];

/**
 * The query as the search compares it: Unicode NFKC, lowercase, without accents, with runs of
 * spaces turned into one. "  Pokémon   Ｇｏ " becomes "pokemon go". The database applies the
 * same steps to titles, so both sides match.
 */
export function normalizeQuery(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export const searchTypeSchema = z.enum(searchTypes);

/**
 * Trigram similarity between 0 and 1, the same idea as `pg_trgm`: the share of three-letter
 * pieces the two texts have in common. Used to order results that come from different places.
 */
export function similarity(a: string, b: string): number {
  const pieces = (text: string) => {
    const padded = `  ${text} `;
    const set = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  };
  if (a === "" || b === "") return 0;
  const left = pieces(a);
  const right = pieces(b);
  let shared = 0;
  for (const piece of left) if (right.has(piece)) shared += 1;
  return shared / (left.size + right.size - shared);
}
