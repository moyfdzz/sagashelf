import type { NormalizedMedia } from "../types";

/** What the search of Open Library sends for one work, reduced to the fields that are read. */
export type OpenLibrarySearchDoc = {
  /** `/works/OL893414W` */
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  edition_count?: number;
};

/** A work as `/works/OL893414W.json` sends it. */
export type OpenLibraryWork = {
  key?: string;
  title?: string;
  /** A text, or an object with the text in `value`. */
  description?: string | { value?: string };
  type?: { key?: string };
  /** Cover ids; the first ones can be -1 when a cover was removed. */
  covers?: number[];
  /** For a work that was merged into another one. */
  location?: string;
};

export const coverBase = "https://covers.openlibrary.org/b/id";

const workKey = /^OL[0-9]{1,12}W$/;

/** `/works/OL893414W` or `OL893414W` as the id we keep (`OL893414W`), or null. */
export function parseExternalId(value: string): string | null {
  const id = value.replace(/^\/works\//, "");
  return workKey.test(id) ? id : null;
}

const textOrNull = (value: string | null | undefined) =>
  value && value.trim() !== "" ? value.trim() : null;

/** The description of a work as plain text. Open Library keeps line breaks as `\r\n`. */
export function descriptionOf(work: OpenLibraryWork): string | null {
  const raw =
    typeof work.description === "string"
      ? work.description
      : work.description?.value;
  return textOrNull(raw?.replace(/\r\n?/g, "\n"));
}

/**
 * One work as a title of ours. Open Library writes its descriptions in one language, mostly
 * English, so a description fills `en` whatever language was asked: a Spanish page falls back to
 * it. The cover is the large size; the image proxy asks for the size a page needs.
 */
export function mapWork(
  doc: OpenLibrarySearchDoc,
  description: string | null = null,
): NormalizedMedia | null {
  const id = parseExternalId(doc.key ?? "");
  const title = textOrNull(doc.title);
  if (!id || !title) return null;

  const creators = (doc.author_name ?? [])
    .map((name) => textOrNull(name))
    .filter((name): name is string => name !== null);

  return {
    type: "book",
    title,
    originalTitle: null,
    year: doc.first_publish_year ?? null,
    synopsis: description ? { en: description } : {},
    ...(creators.length > 0 ? { creators } : {}),
    imageUrl: doc.cover_i ? `${coverBase}/${doc.cover_i}-L.jpg` : null,
    status: "unknown",
    // More editions means a book people keep printing; capped so it stays near the other sources.
    popularity: Math.min(doc.edition_count ?? 0, 100),
    externalId: { provider: "open_library", id },
  };
}

const sameBook = (item: NormalizedMedia) =>
  `${item.title.toLocaleLowerCase()}|${(item.creators?.[0] ?? "").toLocaleLowerCase()}`;

/**
 * Open Library sometimes has the same book as several works. When two have the same title and the
 * same first author, the one with more editions stays, in the place of the first one.
 */
export function groupWorks(items: NormalizedMedia[]): NormalizedMedia[] {
  const kept = new Map<string, NormalizedMedia>();
  for (const item of items) {
    const key = sameBook(item);
    const other = kept.get(key);
    if (!other || item.popularity > other.popularity) kept.set(key, item);
  }
  return [...kept.values()];
}
