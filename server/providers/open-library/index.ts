import { createHttpClient, ProviderError, type HttpClient } from "../http";
import { normalizeIsbn } from "../isbn";
import type { MediaProvider, NormalizedMedia } from "../types";
import {
  descriptionOf,
  groupWorks,
  mapWork,
  parseExternalId,
  type OpenLibrarySearchDoc,
  type OpenLibraryWork,
} from "./map";

const baseUrl = "https://openlibrary.org";

// Open Library allows 3 requests per second to a client that says who it is (the `User-Agent`
// every provider call carries) and 1 to one that does not. Terms read 2026-10-28.
const requestsPerSecond = 3;

const searchFields =
  "key,title,author_name,first_publish_year,cover_i,edition_count";
const pageSize = 20;

type SearchResponse = { docs?: OpenLibrarySearchDoc[] };

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
      return groupWorks(
        docs
          .map((doc) => mapWork(doc))
          .filter((item): item is NormalizedMedia => item !== null),
      );
    },

    async getById(externalId, { signal }) {
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
      return mapWork(
        doc ?? {
          key: `/works/${id}`,
          title: work.title,
          cover_i: work.covers?.find((cover) => cover > 0),
        },
        descriptionOf(work),
      );
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
