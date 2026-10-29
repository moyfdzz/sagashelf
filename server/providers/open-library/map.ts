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
  /** Codes of the languages of its editions (`spa`, `eng`). */
  language?: string[];
  /** The edition that matched the query; with a language filter, one in that language. */
  editions?: { docs?: { title?: string; language?: string[] }[] };
};

/** An edition as `/works/OL893414W/editions.json` sends it. */
export type OpenLibraryEdition = {
  title?: string;
  languages?: { key?: string }[];
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

/** Whether the editions of the work include one in Spanish, so it is worth asking for its title. */
export const hasSpanishEdition = (doc: OpenLibrarySearchDoc) =>
  doc.language?.includes("spa") ?? false;

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

// Accents and case do not tell two spellings of one title apart.
const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The title of the book in Spanish, from the titles of its Spanish editions, or null when there is
 * no clear one (the original title stays then). Empty titles, the original title itself, and
 * titles with a slash, parentheses or brackets (two languages in one, an edition note, a
 * collection) are ignored; the same title written with other capitals counts as one. The most
 * common title wins, and a tie is no answer. Of the spellings of the winner, the most common
 * wins, then the first one.
 */
export function pickSpanishTitle(
  candidates: readonly (string | null | undefined)[],
  original: string,
): string | null {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    const title = textOrNull(candidate)?.replace(/\s+/g, " ");
    if (!title || /[/()[\]]/.test(title) || fold(title) === fold(original)) {
      continue;
    }
    const spellings = groups.get(fold(title)) ?? [];
    spellings.push(title);
    groups.set(fold(title), spellings);
  }

  const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
  const [best, next] = ranked;
  if (!best || (next && next.length === best.length)) return null;

  let winner = best[0] as string;
  let winnerCount = 0;
  for (const spelling of best) {
    const count = best.filter((other) => other === spelling).length;
    if (count > winnerCount) {
      winner = spelling;
      winnerCount = count;
    }
  }
  return winner;
}

/** The titles of the editions that say they are in Spanish. */
export const spanishEditionTitles = (editions: readonly OpenLibraryEdition[]) =>
  editions
    .filter((edition) =>
      edition.languages?.some((language) => language.key === "/languages/spa"),
    )
    .map((edition) => edition.title);

/**
 * The same book with the title in Spanish. The title Open Library gives becomes the original, and
 * is kept as the English one too: it is nearly always English, like its descriptions, and without
 * it a visitor in English would see the Spanish title until the book is opened in English.
 */
export const withSpanishTitle = (
  item: NormalizedMedia,
  title: string | null,
): NormalizedMedia =>
  title
    ? { ...item, title, titles: { en: item.title }, originalTitle: item.title }
    : item;

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
