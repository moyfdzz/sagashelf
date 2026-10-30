import { createHttpClient, ProviderError, type HttpClient } from "../http";
import { normalizeIsbn } from "../isbn";
import type { MediaProvider, NormalizedMedia } from "../types";
import {
  descriptionOf,
  groupWorks,
  hasSpanishEdition,
  mapWork,
  parseExternalId,
  pickSpanishTitle,
  spanishEditionTitles,
  withSpanishTitle,
  type OpenLibraryEdition,
  type OpenLibrarySearchDoc,
  type OpenLibraryWork,
} from "./map";

const baseUrl = "https://openlibrary.org";

// Open Library allows 3 requests per second to a client that says who it is (the `User-Agent`
// every provider call carries) and 1 to one that does not. Terms read 2026-10-28.
const requestsPerSecond = 3;

const searchFields =
  "key,title,author_name,first_publish_year,cover_i,edition_count,language";
const pageSize = 20;

type SearchResponse = { docs?: OpenLibrarySearchDoc[] };
type EditionsResponse = { entries?: OpenLibraryEdition[] };

// The editions of one work that a page asks for; a work with more has the rest left out.
const editionsLimit = 100;

/**
 * Open Library through the `MediaProvider` interface: books. It needs no key, so nothing is a
 * secret here. The terms ask to cache responses and not to download the catalog through the API
 * (the search is cached by the pipeline, and a work is fetched only when somebody opens it).
 * Covers are never fetched here: the page asks our image proxy (ADR-017). Terms read 2026-10-28.
 */
export function createOpenLibraryProvider(http: HttpClient): MediaProvider {
  async function searchDocs(
    q: string,
    lang: string | null,
    limit: number,
    signal?: AbortSignal,
  ): Promise<OpenLibrarySearchDoc[]> {
    const params = new URLSearchParams({
      q,
      fields: searchFields,
      limit: String(limit),
    });
    if (lang) params.set("lang", lang);
    const data = await http.getJson<SearchResponse>(
      `${baseUrl}/search.json?${params}`,
      { signal },
    );
    return data.docs ?? [];
  }

  /**
   * The title in Spanish of each work that has a Spanish edition, in one call: the search keeps only
   * the works with an edition in Spanish and says which one matched. It gives one edition per work,
   * so a noisy title is dropped and the work keeps its own. This only changes how a title reads, so
   * a failure leaves the titles Open Library gave.
   */
  async function spanishTitles(
    docs: readonly OpenLibrarySearchDoc[],
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const keys = docs.filter(hasSpanishEdition).map((doc) => doc.key);
    if (keys.length === 0) return found;

    const params = new URLSearchParams({
      q: `(${keys.map((key) => `key:${key}`).join(" OR ")}) AND language:spa`,
      fields: "key,editions,editions.title,editions.language",
      limit: String(keys.length),
    });
    try {
      const data = await http.getJson<SearchResponse>(
        `${baseUrl}/search.json?${params}`,
        { signal },
      );
      for (const doc of data.docs ?? []) {
        const original = docs.find((other) => other.key === doc.key)?.title;
        const title = pickSpanishTitle(
          doc.editions?.docs?.map((edition) => edition.title) ?? [],
          original ?? "",
        );
        if (doc.key && title) found.set(doc.key, title);
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
    }
    return found;
  }

  return {
    id: "open_library",
    capabilities: { types: ["book"], parts: false, trending: false },
    attribution: {
      name: "Open Library",
      url: "https://openlibrary.org",
      notice: "Book data from Open Library, a project of the Internet Archive.",
    },

    async search(query, { type, locale, signal }) {
      const text = query.trim();
      if (text === "" || (type !== undefined && type !== "book")) return [];

      // A number that is an ISBN finds that book, written with hyphens or without them.
      const isbn = normalizeIsbn(text);
      const docs = await searchDocs(
        isbn ? `isbn:${isbn}` : text,
        locale,
        pageSize,
        signal,
      );
      const works = groupWorks(
        docs
          .map((doc) => mapWork(doc))
          .filter((item): item is NormalizedMedia => item !== null),
      );
      if (locale !== "es") return works;

      const titles = await spanishTitles(
        docs.filter((doc) =>
          works.some((work) => `/works/${work.externalId.id}` === doc.key),
        ),
        signal,
      );
      return works.map((work) =>
        withSpanishTitle(
          work,
          titles.get(`/works/${work.externalId.id}`) ?? null,
        ),
      );
    },

    async getById(externalId, { locale, signal }) {
      const id = parseExternalId(externalId);
      if (!id) return null;

      let work: OpenLibraryWork;
      try {
        work = await http.getJson<OpenLibraryWork>(
          `${baseUrl}/works/${id}.json`,
          { signal },
        );
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
      // A work merged into another one, or deleted, is not this title any more. Following the
      // redirect would save the other work's id under this row.
      if (work.type?.key && work.type.key !== "/type/work") return null;

      // The search has what the work lacks (authors, cover, year) in one call.
      const [doc] = await searchDocs(`key:/works/${id}`, null, 1, signal);
      const book = mapWork(
        doc ?? {
          key: `/works/${id}`,
          title: work.title,
          cover_i: work.covers?.find((cover) => cover > 0),
        },
        descriptionOf(work),
        // A work with no subjects says "none", so the refresh job does not ask for it again.
        work.subjects ?? [],
      );
      if (!book || locale !== "es" || !doc || !hasSpanishEdition(doc)) {
        return book;
      }

      // The editions of the work say what it is called in Spanish; the title most of them share wins.
      try {
        const editions = await http.getJson<EditionsResponse>(
          `${baseUrl}/works/${id}/editions.json?limit=${editionsLimit}`,
          { signal },
        );
        return withSpanishTitle(
          book,
          pickSpanishTitle(
            spanishEditionTitles(editions.entries ?? []),
            book.title,
          ),
        );
      } catch (error) {
        // Only the title in Spanish is missing; the book itself was read.
        if (error instanceof ProviderError) return book;
        throw error;
      }
    },

    async getParts() {
      return [];
    },
  };
}

/** The Open Library provider with its rate. There is no secret to pass. */
export function createOpenLibraryProviderWithDefaults(
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
): MediaProvider {
  return createOpenLibraryProvider(
    createHttpClient({
      provider: "open_library",
      ratePerSecond: requestsPerSecond,
      ...overrides,
    }),
  );
}
