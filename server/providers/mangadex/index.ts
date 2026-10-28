import { createHttpClient, ProviderError, type HttpClient } from "../http";
import { isRemoved } from "../removed";
import type { MediaProvider, NormalizedMedia } from "../types";
import {
  allowedRatings,
  mapManga,
  parseExternalId,
  type MangadexManga,
} from "./map";

const baseUrl = "https://api.mangadex.org";

// MangaDex allows about 5 requests per second per address and bans one that keeps asking after a
// 429 (terms read 2026-10-28). Stay under it; a Worker shares its address with others.
const requestsPerSecond = 4;
const pageSize = 20;

type Collection = { data?: MangadexManga[] };
type Single = { data?: MangadexManga };

function params(extra: Record<string, string> = {}): URLSearchParams {
  const query = new URLSearchParams(extra);
  // The authors and the cover come in the same answer, so a title costs one call.
  for (const kind of ["cover_art", "author", "artist"]) {
    query.append("includes[]", kind);
  }
  return query;
}

/**
 * MangaDex through the `MediaProvider` interface: manga series, metadata only. It never asks for
 * chapters. The terms (read 2026-10-28) require crediting MangaDex, forbid ads and paid services,
 * ask for a real `User-Agent` and no `Via` header, and say that its images must go through our own
 * proxy (a hotlinked image gets a different one). `removed` is the list of titles that must not be
 * shown (ADR-022).
 */
export function createMangadexProvider(
  http: HttpClient,
  removed?: ReadonlySet<string>,
): MediaProvider {
  const shown = (item: NormalizedMedia | null): item is NormalizedMedia =>
    item !== null && !isRemoved("mangadex", item.externalId.id, removed);

  return {
    id: "mangadex",
    capabilities: { types: ["manga"], parts: false, trending: false },
    attribution: {
      name: "MangaDex",
      url: "https://mangadex.org",
      notice:
        "Manga data from MangaDex. Metadata only: chapters are not shown.",
    },

    async search(query, { type, locale, signal }) {
      const text = query.trim();
      if (text === "" || (type !== undefined && type !== "manga")) return [];

      const search = params({ title: text, limit: String(pageSize) });
      search.append("order[relevance]", "desc");
      for (const rating of allowedRatings) {
        search.append("contentRating[]", rating);
      }
      const data = await http.getJson<Collection>(
        `${baseUrl}/manga?${search}`,
        { signal },
      );
      return (data.data ?? [])
        .map((raw) => mapManga(raw, locale))
        .filter(shown);
    },

    async getById(externalId, { locale, signal }) {
      const id = parseExternalId(externalId);
      if (!id || isRemoved("mangadex", id, removed)) return null;
      try {
        const data = await http.getJson<Single>(
          `${baseUrl}/manga/${id}?${params()}`,
          { signal },
        );
        const item = data.data ? mapManga(data.data, locale) : null;
        return shown(item) ? item : null;
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    },

    // Chapters are never read: the terms of the scanlation groups apply to them, not to metadata.
    async getParts() {
      return [];
    },
  };
}

/** The MangaDex provider with its rate and the statuses that must stop it. No key is needed. */
export function createMangadexProviderWithDefaults(
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
  removed?: ReadonlySet<string>,
): MediaProvider {
  return createMangadexProvider(
    createHttpClient({
      provider: "mangadex",
      ratePerSecond: requestsPerSecond,
      // A 429 or a 403 means the address is being limited or banned: no retry, circuit open.
      stopOnStatus: [429, 403],
      stopMs: 60_000,
      ...overrides,
    }),
    removed,
  );
}
