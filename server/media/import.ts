import type { SqlExecutor } from "../db/clerk-sync";
import type { MediaDetail } from "../db/media-detail";
import {
  providerDataMaxAgeDays,
  saveMedia,
  saveParts,
} from "../db/media-store";
import type { Locale, MediaKind, MediaProvider } from "../providers/types";

/** A title is refreshed this long before the 6 months TMDB lets us keep it (ADR-016). */
export const refreshAfterDays = providerDataMaxAgeDays - 30;

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Whether a saved title should be asked for again: its data is close to the 6 months, or it has
 * no synopsis in the language of the visitor (it was saved in the other one). The second case
 * waits a day, so a title the source has no text for in that language is not asked for on every
 * visit.
 */
export function needsRefresh(
  detail: Pick<MediaDetail, "fetchedAt" | "synopsis">,
  locale: Locale,
  now: number = Date.now(),
): boolean {
  const ageDays = (now - detail.fetchedAt.getTime()) / dayMs;
  if (ageDays > refreshAfterDays) return true;
  return !detail.synopsis[locale] && ageDays > 1;
}

/**
 * Asks the provider for a title (and its seasons) and saves it, and returns where it is. Null
 * when the provider does not know it. A failure of the provider throws: the caller decides what
 * to tell the visitor. A title is saved only here, when somebody opens it (ADR-004).
 */
export async function importMedia(
  deps: { db: SqlExecutor; providers: readonly MediaProvider[] },
  provider: string,
  externalId: string,
  locale: Locale,
): Promise<{ id: string; type: MediaKind; title: string } | null> {
  const source = deps.providers.find((candidate) => candidate.id === provider);
  if (!source) return null;

  const media = await source.getById(externalId, { locale });
  if (!media) return null;

  const id = await saveMedia(deps.db, media);
  if (source.capabilities.parts) {
    try {
      await saveParts(deps.db, id, await source.getParts(externalId));
    } catch {
      // The title is useful without its seasons; the next refresh tries again.
    }
  }
  return { id, type: media.type, title: media.title };
}
